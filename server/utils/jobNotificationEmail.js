const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const { areJobNotificationsActive } = require("./appSettings");

async function notificationsEnabled() {
  return areJobNotificationsActive();
}

function getAppBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.AUTH0_BASE_URL || "https://ettool.ose.nm.gov").replace(/\/$/, "");
}

function getSesClient() {
  const region = process.env.SES_REGION || "us-west-2";
  return new SESClient({ region });
}

function getFromEmail() {
  return (process.env.SES_FROM_EMAIL || "").trim();
}

function buildTestEmailContent(recipientName, recipientEmail) {
  const appUrl = getAppBaseUrl();
  const subject = "ET Tool: Test job completion notification";

  const textLines = [
    `Hello ${recipientName},`,
    "",
    "This is a test email from the New Mexico ET Reporting Tool.",
    "",
    "If you received this message, job completion notifications are configured correctly.",
    "",
    `Recipient: ${recipientEmail}`,
  ];

  if (appUrl) {
    textLines.push("", `Open the ET Tool: ${appUrl}`);
  }

  textLines.push("", "This is an automated message from the New Mexico ET Reporting Tool.");
  const textBody = textLines.join("\n");

  const htmlBody = [
    `<p>Hello ${recipientName},</p>`,
    "<p>This is a <strong>test email</strong> from the New Mexico ET Reporting Tool.</p>",
    "<p>If you received this message, job completion notifications are configured correctly.</p>",
    `<p><strong>Recipient:</strong> ${recipientEmail}</p>`,
    appUrl ? `<p><a href="${appUrl}">Open the ET Tool</a></p>` : "",
    "<p><em>This is an automated message from the New Mexico ET Reporting Tool.</em></p>",
  ]
    .filter(Boolean)
    .join("");

  return { subject, textBody, htmlBody };
}

async function sendSesEmail({ to, subject, textBody, htmlBody }) {
  if (!(await notificationsEnabled())) {
    throw new Error("Job notifications are disabled on this server");
  }

  const fromEmail = getFromEmail();
  if (!fromEmail) {
    throw new Error("SES_FROM_EMAIL is not configured");
  }

  if (!to) {
    throw new Error("Missing recipient email");
  }

  const client = getSesClient();
  const command = new SendEmailCommand({
    Source: fromEmail,
    Destination: {
      ToAddresses: [to],
    },
    Message: {
      Subject: {
        Data: subject,
        Charset: "UTF-8",
      },
      Body: {
        Text: {
          Data: textBody,
          Charset: "UTF-8",
        },
        Html: {
          Data: htmlBody,
          Charset: "UTF-8",
        },
      },
    },
  });

  await client.send(command);
}

async function sendTestJobNotificationEmail({ name, email }) {
  const recipientName = name || email || "there";
  const { subject, textBody, htmlBody } = buildTestEmailContent(recipientName, email);
  await sendSesEmail({ to: email, subject, textBody, htmlBody });
}

module.exports = {
  sendTestJobNotificationEmail,
};
