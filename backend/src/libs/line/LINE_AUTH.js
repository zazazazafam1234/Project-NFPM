import CryptoJS from "crypto-js";
import JSEncrypt from "jsencrypt";

export class LINELogin {
      constructor() {
            this.baseUrl = "https://gd2.line.naver.jp";
            this.headers = {
                  "X-Line-Application": "CHROMEOS\t3.7.1\tCHROME_OS\t1",
                  "User-Agent": "Line/3.7.1",
                  "Content-Type": "application/x-thrift"
            };
      }

      // Login ด้วย Email และ Password
      async loginWithCredentials(email, password) {
            try {
                  console.log("🔐 กำลัง login...");

                  // Step 1: Get RSA Key
                  const rsaKey = await this.getRSAKey(email);
                  if (!rsaKey) throw new Error("Failed to get RSA key");

                  // Step 2: Encrypt password
                  const encryptedPassword = this.encryptPassword(password, rsaKey);

                  // Step 3: Login
                  const authResult = await this.authenticate(email, encryptedPassword, rsaKey);

                  if (!authResult.authToken) {
                        throw new Error("Login failed: " + (authResult.error || "Unknown error"));
                  }

                  console.log("✅ Login สำเร็จ!");

                  // Step 4: Issue token
                  const token = await this.issueToken(authResult.authToken);

                  return {
                        authToken: authResult.authToken,
                        certificate: authResult.certificate,
                        cookie: `lct=${token.lct}`,
                        lct: token.lct
                  };

            } catch (err) {
                  console.error("❌ Login ล้มเหลว:", err.message);
                  throw err;
            }
      }

      // ดึง RSA Key สำหรับ encrypt password
      async getRSAKey(email) {
            const payload = this.buildRSAKeyRequest(email);

            const res = await fetch(`${this.baseUrl}/api/v4p/rs`, {
                  method: "POST",
                  headers: this.headers,
                  body: payload
            });

            if (!res.ok) return null;

            const data = await res.arrayBuffer();
            return this.parseRSAKey(new Uint8Array(data));
      }

      // Encrypt password ด้วย RSA
      encryptPassword(password, rsaKey) {
            const { sessionKey, nvalue, evalue } = rsaKey;

            // สร้าง RSA public key ด้วย JSEncrypt
            const encrypt = new JSEncrypt();

            // แปลง n และ e เป็น PEM format
            const publicKeyPEM = this.createPublicKeyPEM(nvalue, evalue);
            encrypt.setPublicKey(publicKeyPEM);

            // Encrypt ข้อมูล
            const dataToEncrypt = password + "\x00" + sessionKey;
            const encrypted = encrypt.encrypt(dataToEncrypt);

            // แปลงจาก base64 เป็น hex
            return this.base64ToHex(encrypted);
      }

      // สร้าง PEM format public key
      createPublicKeyPEM(nHex, eHex) {
            // แปลง hex เป็น base64
            const n = this.hexToBase64(nHex);
            const e = this.hexToBase64(eHex);

            return `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA${n}AQAB
-----END PUBLIC KEY-----`;
      }

      // Helper: hex to base64
      hexToBase64(hex) {
            const bytes = [];
            for (let i = 0; i < hex.length; i += 2) {
                  bytes.push(parseInt(hex.substr(i, 2), 16));
            }
            return btoa(String.fromCharCode.apply(null, bytes));
      }

      // Helper: base64 to hex
      base64ToHex(base64) {
            const binary = atob(base64);
            let hex = '';
            for (let i = 0; i < binary.length; i++) {
                  const code = binary.charCodeAt(i);
                  hex += code.toString(16).padStart(2, '0');
            }
            return hex;
      }

      // ทำการ authenticate
      async authenticate(email, encryptedPassword, rsaKey) {
            const payload = this.buildLoginRequest(email, encryptedPassword, rsaKey);

            const res = await fetch(`${this.baseUrl}/api/v4p/rs`, {
                  method: "POST",
                  headers: this.headers,
                  body: payload
            });

            if (!res.ok) {
                  throw new Error(`HTTP ${res.status}`);
            }

            const data = await res.arrayBuffer();
            return this.parseLoginResponse(new Uint8Array(data));
      }

      // Issue token สำหรับใช้งาน
      async issueToken(authToken) {
            const res = await fetch(`${this.baseUrl}/Q`, {
                  method: "POST",
                  headers: {
                        ...this.headers,
                        "X-Line-Access": authToken
                  }
            });

            const data = await res.json();
            return data;
      }

      // Build Thrift request สำหรับ RSA Key
      buildRSAKeyRequest(email) {
            // Thrift binary protocol
            // Structure: getAuthQrcode(email, systemName)
            const buffer = Buffer.alloc(1024);
            let offset = 0;

            // Email field
            buffer.writeUInt8(11, offset++); // String type
            buffer.writeInt16BE(2, offset); offset += 2; // Field ID
            buffer.writeInt32BE(email.length, offset); offset += 4;
            buffer.write(email, offset); offset += email.length;

            // System name
            const systemName = "CHROMEOS";
            buffer.writeUInt8(11, offset++);
            buffer.writeInt16BE(3, offset); offset += 2;
            buffer.writeInt32BE(systemName.length, offset); offset += 4;
            buffer.write(systemName, offset); offset += systemName.length;

            // Stop field
            buffer.writeUInt8(0, offset++);

            return buffer.slice(0, offset);
      }

      // Build Thrift request สำหรับ Login
      buildLoginRequest(email, encryptedPassword, rsaKey) {
            const buffer = Buffer.alloc(2048);
            let offset = 0;

            // loginWithIdentityCredentialForCertificate
            // Field 1: email
            buffer.writeUInt8(11, offset++);
            buffer.writeInt16BE(1, offset); offset += 2;
            buffer.writeInt32BE(email.length, offset); offset += 4;
            buffer.write(email, offset); offset += email.length;

            // Field 2: encrypted password
            buffer.writeUInt8(11, offset++);
            buffer.writeInt16BE(2, offset); offset += 2;
            buffer.writeInt32BE(encryptedPassword.length / 2, offset); offset += 4;
            Buffer.from(encryptedPassword, "hex").copy(buffer, offset);
            offset += encryptedPassword.length / 2;

            // Field 3: session key
            buffer.writeUInt8(11, offset++);
            buffer.writeInt16BE(3, offset); offset += 2;
            buffer.writeInt32BE(rsaKey.sessionKey.length, offset); offset += 4;
            buffer.write(rsaKey.sessionKey, offset); offset += rsaKey.sessionKey.length;

            buffer.writeUInt8(0, offset++);

            return buffer.slice(0, offset);
      }

      // Parse RSA Key จาก response
      parseRSAKey(buffer) {
            // Simplified parser - ควรใช้ thrift library จริงๆ
            try {
                  const decoder = new TextDecoder("utf-8", { fatal: false });
                  const text = decoder.decode(buffer);

                  // Extract hex values (simplified)
                  const sessionKey = this.extractHex(buffer, 0);
                  const nvalue = this.extractHex(buffer, 50);
                  const evalue = "010001"; // Standard RSA exponent

                  return { sessionKey, nvalue, evalue };
            } catch {
                  return null;
            }
      }

      // Parse Login response
      parseLoginResponse(buffer) {
            try {
                  const decoder = new TextDecoder("utf-8", { fatal: false });
                  const text = decoder.decode(buffer);

                  // Extract auth token (simplified pattern matching)
                  const tokenMatch = text.match(/[a-zA-Z0-9_\-]{100,}/);
                  const certMatch = text.match(/[a-zA-Z0-9+\/=]{50,}/);

                  return {
                        authToken: tokenMatch?.[0] || "",
                        certificate: certMatch?.[0] || ""
                  };
            } catch {
                  return { error: "Parse failed" };
            }
      }

      // Helper: Extract hex from buffer
      extractHex(buffer, offset) {
            const length = Math.min(32, buffer.length - offset);
            return buffer.slice(offset, offset + length).toString("hex");
      }
}

// ตัวอย่างการใช้งาน
export async function loginToLINE(email, password) {
      const login = new LINELogin();

      try {
            const result = await login.loginWithCredentials(email, password);

            console.log("\n🎉 Login สำเร็จ!");
            console.log("📝 Cookie:", result.cookie);
            console.log("🔑 LCT:", result.lct);

            return result;

      } catch (err) {
            console.error("❌ เกิดข้อผิดพลาด:", err.message);
            throw err;
      }
}

// ใช้งานแบบง่าย
// const result = await loginToLINE("your-email@example.com", "your-password");
// const client = new LINESSEClient({ cookie: result.cookie });