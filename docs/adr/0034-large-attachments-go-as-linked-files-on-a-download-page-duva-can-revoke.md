# Large attachments go as linked files, on a download page Duva can revoke

SES sends a message of up to 40 MB, encoded, but receivers take less: Gmail sends up to 25 MB, Outlook.com takes about 20 MB, and many company servers 10 MB. So when carrying every attachment would make a message more than 10 MB, encoded, Duva sends the largest as linked files until it fits, and the sender may link any attachment by choice. The composer shows which will be linked before the send. Nicklas chose this on 2026-10-09.

- **The message lists each linked file after its text,** in its HTML and plain-text parts alike: its name, its size, and the date its link stops working. There's no banner or logo.
- **A link works for 30 days after the send by default.** The sender may choose 7 days or a year. Then the file is deleted.
- **Anyone with the link may open it.** The link carries a long random token, so it works for outside recipients and forwards, as an attachment would.
- **The link opens a small download page,** with the file's name, its size, the sender and the date, and a Download button. Never the file itself, since company link scanners open every link in mail, and pulling a 5 GB file each time would cost the organization CloudFront's transfer.
- **The sender can take a file back.** Stopping sharing in the sent mail ends the link at once and deletes the file, and so do undoing the send and erasing the sent mail. So the links are Duva's own tickets, stored as hashes as download links are (ADR-0013), not CloudFront signed URLs, which can't be revoked.
- **Downloads are counted** from the page's button, so scanners don't count. The sender sees the count, and Coo's bubble tells them the first time a file is downloaded. No downloader's address is kept.
- **One file may be up to 5 GB.** Admins cap what each human may have linked at once, 20 GB by default.
- **The same rule holds for every recipient,** the organization's own addresses included.
- **Every actor that may draft may upload.** An agent's files wait with its send, and Approvals shows each one, attached or linked, for the sponsor to open first. An agent's files count toward its sponsor's cap.

## Considered options

- A threshold of 20 or 25 MB. Rejected: mail between 10 and 25 MB bounces at many company servers, and a bounce costs the sender a retry.
- Links straight to the file. Rejected: every link scanner would download it.
- CloudFront signed URLs. Rejected: a URL can't be taken back before it expires, and the sender may need to.
- Attaching in full between the organization's own mailboxes. Rejected: a message to inside and outside addresses would need the outside rule anyway, and one rule reads the same for everyone.
- A code by email before download. Rejected: it breaks forwards and mailing lists.

## Consequences

- Drafts gain uploaded attachments. Browsers and agents upload straight to S3 with presigned requests, multipart for large files, since API Gateway takes at most 10 MB a request, and no Lambda in the path may be world-invocable.
- The files sit in a bucket of their own, without versioning, so deleting a file deletes it. CloudFront serves the download page through the download Lambda, as attachment downloads are, which checks the ticket on each Download. It then hands out a signed URL for the file that lasts minutes, so a stopped link stops at once, and no Lambda streams gigabytes.
- A file uploaded to a draft that's deleted, or rejected and never sent, is deleted with the draft. A forward of a sent mail with linked files carries the same links, with their dates.
- The download page lives on the web app's CloudFront domain until the organization has a domain of its own for it.
