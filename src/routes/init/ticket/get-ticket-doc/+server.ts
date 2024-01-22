import { APPWRITE_COL_INIT_ID, APPWRITE_DB_INIT_ID } from '$env/static/private';
import { appwriteInit } from '$lib/appwrite/init.js';
import type { User } from '$routes/init/helpers.js';
import { ID, Query } from 'appwrite';
import type { TicketData, TicketDoc } from '../constants.js';

async function getTicketDocByUser(user: User) {
  const [gh, aw] = await Promise.all([
    user.github?.login
      ? appwriteInit.database.listDocuments(
        APPWRITE_DB_INIT_ID,
        APPWRITE_COL_INIT_ID,
        [Query.equal('gh_user', user.github.login)]
      )
      : null,
    user.appwrite?.$id
      ? appwriteInit.database.listDocuments(
        APPWRITE_DB_INIT_ID,
        APPWRITE_COL_INIT_ID,
        [Query.equal('aw_email', user.appwrite.email)]
      )
      : null
  ]);

  if (gh?.total || aw?.total) {
    const gh_doc = gh?.documents[0] as unknown as TicketDoc;
    const aw_doc = aw?.documents[0] as unknown as TicketDoc;
    if (gh_doc && aw_doc && gh_doc.$id !== aw_doc.$id) {
      // Delete the oldest document ids
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
    return doc;
  } else {
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
        name: user.appwrite?.name ?? user.github?.name
      }
    )) as unknown as TicketDoc;
  }
}

async function getTicketDocById(id: string) {
  console.log(id);
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