export function authEmailMessages(payload: unknown, supabaseUrl:string, appOrigin:string):Array<{to:string[];reply_to:string;subject:string;text:string;html:string}>;
