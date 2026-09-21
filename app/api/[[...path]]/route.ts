import { env } from 'cloudflare:workers';
import { handleAPI } from '../../../server/api.js';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleAPI(request,env);}
export function POST(request:Request){return handleAPI(request,env);}
export function PUT(request:Request){return handleAPI(request,env);}
export function PATCH(request:Request){return handleAPI(request,env);}
export function DELETE(request:Request){return handleAPI(request,env);}
