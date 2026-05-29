import crypto from "crypto";

// Base32 decoding helper for converting pairing keys
function base32Decode(base32: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = base32.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  const length = cleaned.length;
  let bits = 0;
  let value = 0;
  let index = 0;
  
  // Allocate target buffer
  const buffer = Buffer.alloc(Math.floor((length * 5) / 8));

  for (let i = 0; i < length; i++) {
    const val = alphabet.indexOf(cleaned[i]);
    if (val === -1) {
      throw new Error(`Invalid base32 character: ${cleaned[i]}`);
    }
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      buffer[index++] = (value >> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return buffer;
}

// Generate standard 16-character Base32 secret for pairing
export function generateSecret(length = 16): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const randomBytes = crypto.randomBytes(length);
  let secret = "";
  for (let i = 0; i < length; i++) {
    secret += alphabet[randomBytes[i] % 32];
  }
  return secret;
}

// Generate standard TOTP token (RFC 6238)
export function generateTOTP(secret: string, offset = 0): string {
  const key = base32Decode(secret);
  const epoch = Math.floor(Date.now() / 1000);
  const timeStep = Math.floor(epoch / 30) + offset;

  // Time step as 64-bit big-endian integer buffer
  const buffer = Buffer.alloc(8);
  let tmp = timeStep;
  for (let i = 7; i >= 0; i--) {
    buffer[i] = tmp & 0xff;
    tmp >>= 8;
  }

  const hmac = crypto.createHmac("sha1", key);
  hmac.update(buffer);
  const hmacResult = hmac.digest();

  // Dynamic Truncation
  const offsetByte = hmacResult[hmacResult.length - 1] & 0xf;
  const code =
    ((hmacResult[offsetByte] & 0x7f) << 24) |
    ((hmacResult[offsetByte + 1] & 0xff) << 16) |
    ((hmacResult[offsetByte + 2] & 0xff) << 8) |
    (hmacResult[offsetByte + 3] & 0xff);

  const token = (code % 1000000).toString().padStart(6, "0");
  return token;
}

// Verify TOTP token with latency allowance window (e.g. -1, 0, +1 steps)
export function verifyTOTP(token: string, secret: string): boolean {
  // Allow a 1-step window (30 seconds backward and forward) to offset network/device latency
  for (let offset = -1; offset <= 1; offset++) {
    if (generateTOTP(secret, offset) === token) {
      return true;
    }
  }
  return false;
}

// Generate OTPAuth URI compatible with Google Authenticator, Microsoft Authenticator, and Authy QR scans
export function getOTPAuthURL(label: string, issuer: string, secret: string): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
