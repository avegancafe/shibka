// Migration guarantee tests. Every fixture below was generated with the OLD
// Express/Node implementation (server/server.js, now deleted) and is asserted
// here inside workerd — so a green run means existing users' stored password
// hashes and already-issued session cookies still work after the port.
import { describe, expect, it } from "vitest";
import { hashPassword, signToken, verifyPassword, verifyToken } from "../worker/auth.js";

// scrypt$<salt hex>$<key hex> produced by the old server for this password
// (Node scrypt defaults N=16384, r=8, p=1; keylen 64).
const OLD_PASSWORD = "correct horse battery staple";
const OLD_HASH =
  "scrypt$5b1d5f8e9c2a4b6d8e0f1a2b3c4d5e6f$" +
  "ae624c5d5a21d4a84167fb65ef80c471433db03e337976074cdedb8bc3e5abf9" +
  "7719acf1ae1dc9c99970a63d53cd00999c058a87dca09b5afb8d94308d11e7ff";

// A session cookie value minted by the old server with this SESSION_SECRET.
const OLD_SECRET = "test-secret-0123456789abcdef";
const OLD_TOKEN =
  "eyJ1aWQiOjQyLCJleHAiOjQxMDI0NDQ4MDB9.2hRWpUqDYuDPA2WGtDQsD1twSJWc4E4UnrF7L1UAPq4";

describe("passwords (scrypt) stay byte-compatible", () => {
  it("verifies a hash written by the old Node server", async () => {
    expect(await verifyPassword(OLD_PASSWORD, OLD_HASH)).toBe(true);
  });

  it("rejects a wrong password against that same hash", async () => {
    expect(await verifyPassword("correct horse battery stapl", OLD_HASH)).toBe(false);
  });

  it("round-trips a freshly hashed password", async () => {
    const hash = await hashPassword("hunter2hunter2");
    expect(await verifyPassword("hunter2hunter2", hash)).toBe(true);
    expect(await verifyPassword("hunter2hunter3", hash)).toBe(false);
  });

  it("emits the stored hash format the database already holds", async () => {
    const hash = await hashPassword("another-good-password");
    expect(hash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  });

  it("rejects malformed stored values instead of throwing", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$aa$bb")).toBe(false);
  });
});

describe("session tokens stay byte-compatible", () => {
  it("accepts a token issued by the old Node server", () => {
    expect(verifyToken(OLD_TOKEN, OLD_SECRET)).toEqual({ uid: 42, exp: 4102444800 });
  });

  it("re-signs that payload to the exact same token", () => {
    expect(signToken({ uid: 42, exp: 4102444800 }, OLD_SECRET)).toBe(OLD_TOKEN);
  });

  it("round-trips a fresh token", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signToken({ uid: 7, exp }, OLD_SECRET);
    expect(verifyToken(token, OLD_SECRET)).toEqual({ uid: 7, exp });
  });

  it("rejects a tampered signature", () => {
    const [body] = OLD_TOKEN.split(".");
    expect(verifyToken(`${body}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`, OLD_SECRET)).toBe(null);
    expect(verifyToken(OLD_TOKEN, "test-secret-0123456789abcdeg")).toBe(null);
  });

  it("rejects an expired token", () => {
    const token = signToken({ uid: 7, exp: 1_000_000 }, OLD_SECRET); // 1970-01-12
    expect(verifyToken(token, OLD_SECRET)).toBe(null);
  });

  it("rejects junk", () => {
    expect(verifyToken(null, OLD_SECRET)).toBe(null);
    expect(verifyToken("no-dot-here", OLD_SECRET)).toBe(null);
    expect(verifyToken(signToken({ nope: 1 }, OLD_SECRET), OLD_SECRET)).toBe(null);
  });
});
