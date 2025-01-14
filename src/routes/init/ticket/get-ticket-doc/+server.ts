import { APPWRITE_COL_INIT_ID, APPWRITE_DB_INIT_ID, HUBSPOT_LIST_ID } from '$env/static/private';
import { appwriteInit } from '$lib/appwrite/init.js';
import type { User } from '$routes/init/helpers.js';
import { ID, Query } from '@appwrite.io/console';
import type { TicketData, TicketDoc } from '../constants.js';
import { hubspot } from '$lib/hubspot.server.js';
import { isProUser } from '$lib/utils/console.js';

type Contact = {
    id: string;
    properties: {
        email: string;
        hs_object_id: '4831113';
        lastmodifieddate: '2024-01-24T09:16:04.042Z';
    };
};

type ContactResults = {
    results: Array<Contact>;
};

type SendToHubspotArgs = {
    name: string;
    email: string;
};

async function sendToHubspot({ name, email }: SendToHubspotArgs) {
    // See if contact exists
    const contacts: ContactResults = await hubspot
        .fetch('objects/contacts/batch/read', {
            method: 'POST',
            body: JSON.stringify({
                properties: ['email'],
                idProperty: 'email',
                inputs: [
                    {
                        id: email
                    }
                ]
            })
        })
        .then((res) => res.json());
    let contact = contacts.results?.[0];

    if (!contact) {
        contact = await hubspot
            .fetch('objects/contacts', {
                method: 'POST',
                body: JSON.stringify({
                    properties: {
                        email: email,
                        firstname: name
                    }
                })
            })
            .then((res) => res.json());
    }

    await hubspot
        .fetch(`lists/${HUBSPOT_LIST_ID}/memberships/add`, {
            method: 'PUT',
            body: JSON.stringify([contact.id])
        })
        .then((res) => res.json());
}

async function getTicketDocByUser(user: User) {
    if (user.appwrite?.email) {
        sendToHubspot({
            name: user.appwrite?.name ?? user.github?.name ?? user.appwrite.email,
            email: user.appwrite?.email
        });
    }

    const [gh, aw, isPro] = await Promise.all([
        user.github?.login
            ? appwriteInit.database.listDocuments(APPWRITE_DB_INIT_ID, APPWRITE_COL_INIT_ID, [
                  Query.equal('gh_user', user.github.login)
              ])
            : null,
        user.appwrite?.$id
            ? appwriteInit.database.listDocuments(APPWRITE_DB_INIT_ID, APPWRITE_COL_INIT_ID, [
                  Query.equal('aw_email', user.appwrite.email)
              ])
            : null,
        isProUser()
    ]);

    if (gh?.total || aw?.total) {
        const gh_doc = gh?.documents[0] as unknown as TicketDoc;
        const aw_doc = aw?.documents[0] as unknown as TicketDoc;

        // If both documents exist, and they are not the same, delete the oldest one
        if (gh_doc && aw_doc && gh_doc.$id !== aw_doc.$id) {
            const oldest = gh_doc.id < aw_doc.id ? gh_doc.$id : aw_doc.$id;
            const newest = gh_doc.id > aw_doc.id ? gh_doc.$id : aw_doc.$id;
            await appwriteInit.database.updateDocument(
                APPWRITE_DB_INIT_ID,
                APPWRITE_COL_INIT_ID,
                oldest,
                {
                    gh_user: null,
                    aw_email: null
                }
            );
            return (await appwriteInit.database.updateDocument(
                APPWRITE_DB_INIT_ID,
                APPWRITE_COL_INIT_ID,
                newest,
                {
                    gh_user: user.github?.login,
                    aw_email: user.appwrite?.email
                }
            )) as unknown as TicketDoc;
        }

        const doc = gh_doc ?? aw_doc;

        // If the document is missing either the GitHub or Appwrite user, update it
        if (!doc.gh_user || !doc.aw_email) {
            return (await appwriteInit.database.updateDocument(
                APPWRITE_DB_INIT_ID,
                APPWRITE_COL_INIT_ID,
                doc.$id,
                {
                    gh_user: user.github?.login,
                    aw_email: user.appwrite?.email
                }
            )) as unknown as TicketDoc;
        }

        // If the user's pro status has changed, update the document
        if (!!user.appwrite && doc.is_pro !== isPro) {
            return (await appwriteInit.database.updateDocument(
                APPWRITE_DB_INIT_ID,
                APPWRITE_COL_INIT_ID,
                doc.$id,
                {
                    is_pro: isPro
                }
            )) as unknown as TicketDoc;
        }

        // Otherwise, return the document as is
        return doc;
    } else {
        // If no document exists, create one
        const allDocs = await appwriteInit.database.listDocuments(
            APPWRITE_DB_INIT_ID,
            APPWRITE_COL_INIT_ID
        );
        return (await appwriteInit.database.createDocument(
            APPWRITE_DB_INIT_ID,
            APPWRITE_COL_INIT_ID,
            ID.unique(),
            {
                gh_user: user.github?.login ?? undefined,
                aw_email: user.appwrite?.email ?? undefined,
                id: allDocs.total + 1,
                name: user.appwrite?.name ?? user.github?.name,
                is_pro: isPro
            }
        )) as unknown as TicketDoc;
    }
}

async function getTicketDocById(id: string) {
    return (await appwriteInit.database.getDocument(
        APPWRITE_DB_INIT_ID,
        APPWRITE_COL_INIT_ID,
        id
    )) as unknown as Omit<TicketData, 'contributions' | 'variant'>;
}

export async function GET({ url }) {
    if (url.searchParams.has('id')) {
        const res = await getTicketDocById(url.searchParams.get('id') ?? '');
        return new Response(JSON.stringify(res), {
            headers: {
                'content-type': 'application/json'
            }
        });
    } else {
        const user = JSON.parse(url.searchParams.get('user') ?? '{}') as User;
        const res = await getTicketDocByUser(user);
        return new Response(JSON.stringify(res), {
            headers: {
                'content-type': 'application/json'
            }
        });
    }
}
