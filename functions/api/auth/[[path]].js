import { handleAuth } from '../../../server/auth.mjs';
export const onRequest = context => handleAuth(context);
