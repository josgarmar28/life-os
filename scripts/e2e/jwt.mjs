// Firma un JWT HS256 con el secreto local de pruebas (claves anon/service_role locales).
import { createHmac } from 'node:crypto';
const [secret, role] = process.argv.slice(2);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase-local-e2e', role, iat: 1700000000, exp: 4102444800 })}`;
process.stdout.write(`${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`);
