"use server"

import sharp from 'sharp';
import { google } from 'googleapis';
import { render } from '@react-email/components';
import CongratsEmail from '@/app/CongratsEmail/page';

async function fetchImageAsBase64(url) {
      const res = await fetch(url);
      const buffer = Buffer.from(await res.arrayBuffer());
      const pngBuffer = await sharp(buffer).resize({ width: 560 }).png({ quality: 80 }).toBuffer();
      return pngBuffer.toString('base64');
}

export async function getGmailClient() {
      const oauth2Client = new google.auth.OAuth2(
            process.env.GMAIL_CLIENT_ID,
            process.env.GMAIL_CLIENT_SECRET
      );
      oauth2Client.setCredentials({
            refresh_token: process.env.GMAIL_REFRESH_TOKEN
      });
      return google.gmail({ version: 'v1', auth: oauth2Client });
}

async function sendSingleEmail({ to, name, status, logoBase64, bgBase64 }) {
      const gmail = await getGmailClient();

      const html = await render(
            <CongratsEmail name={name} status={status || 'passed'} logoSrc="cid:logo" bgSrc="cid:bg" />
      );

      const subjectMap = {
            passed: 'ยินดีด้วย! คุณผ่านการคัดเลือก CSCAMP 18',
            failed: 'ผลการคัดเลือก CSCAMP 18',
            pending: 'รอผลการคัดเลือก CSCAMP 18',
      };
      const subjectText = subjectMap[status] || subjectMap.passed;

      const boundary = 'boundary_' + Date.now();

      const rawMessage = [
            `From: ${process.env.GMAIL_FROM || "CSCAMP18 <noreply@cscamp.net>"}`,
            `To: ${to}`,
            `Subject: =?UTF-8?B?${Buffer.from(subjectText).toString('base64')}?=`,
            `MIME-Version: 1.0`,
            `Content-Type: multipart/related; boundary="${boundary}"`,
            '',
            `--${boundary}`,
            `Content-Type: text/html; charset=utf-8`,
            '',
            html,
            '',
            `--${boundary}`,
            `Content-Type: image/png`,
            `Content-Transfer-Encoding: base64`,
            `Content-ID: <logo>`,
            `Content-Disposition: inline; filename="logo.png"`,
            '',
            logoBase64,
            '',
            `--${boundary}`,
            `Content-Type: image/png`,
            `Content-Transfer-Encoding: base64`,
            `Content-ID: <bg>`,
            `Content-Disposition: inline; filename="bg.png"`,
            '',
            bgBase64,
            '',
            `--${boundary}--`,
      ].join('\r\n');

      const encoded = Buffer.from(rawMessage).toString('base64url');

      const res = await gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw: encoded }
      });

      return {
            messageId: res.data.id,
            threadId: res.data.threadId,
      };
}

export async function sendCustomEmail({ to, subject, body }) {
      const gmail = await getGmailClient();

      const rawMessage = [
            `To: ${to}`,
            `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
            `MIME-Version: 1.0`,
            `Content-Type: text/html; charset=utf-8`,
            '',
            body,
      ].join('\r\n');

      const encoded = Buffer.from(rawMessage).toString('base64url');

      const res = await gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw: encoded },
      });

      return {
            messageId: res.data.id,
            threadId: res.data.threadId,
      };
}

export async function sendBatchCustomEmails({ recipients, subject, body }) {
      const results = [];

      for (let i = 0; i < recipients.length; i += 10) {
            const batch = recipients.slice(i, i + 10);

            const batchResults = await Promise.allSettled(
                  batch.map(({ email, name }) =>
                        sendCustomEmail({
                              to: email,
                              subject: subject.replace('{{name}}', name || ''),
                              body: body.replace('{{name}}', name || ''),
                        })
                  )
            );

            results.push(...batchResults);

            if (i + 10 < recipients.length) {
                  await new Promise(r => setTimeout(r, 1000));
            }
      }

      return results;
}

export async function sendBatchCongratsEmails({ recipients }) {
      const [logoBase64, bgBase64] = await Promise.all([
            fetchImageAsBase64('https://cscamp.net/images/Logo.webp'),
            fetchImageAsBase64('https://cscamp.net/images/BG/BGLanding.webp'),
      ]);

      const results = [];

      for (let i = 0; i < recipients.length; i += 10) {
            const batch = recipients.slice(i, i + 10);

            const batchResults = await Promise.allSettled(
                  batch.map(({ email, name, status }) =>
                        sendSingleEmail({ to: email, name, status, logoBase64, bgBase64 })
                  )
            );

            results.push(...batchResults);

            if (i + 10 < recipients.length) {
                  await new Promise(r => setTimeout(r, 1000));
            }
      }

      return results;
}