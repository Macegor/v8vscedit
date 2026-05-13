import * as crypto from 'crypto';

export function createWebviewNonce(): string {
  return crypto.randomBytes(32).toString('base64url');
}

