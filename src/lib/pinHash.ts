// src/lib/pinHash.ts
// §2-1: SHA-256 PIN 해시 프로토콜

export async function hashPin(pin: string, deviceId: string): Promise<string> {
  const data = new TextEncoder().encode(pin + deviceId);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyPin(
  inputPin: string,
  deviceId: string,
  storedHash: string
): Promise<boolean> {
  const inputHash = await hashPin(inputPin, deviceId);
  return inputHash === storedHash;
}
