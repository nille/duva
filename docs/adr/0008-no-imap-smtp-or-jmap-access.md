# No IMAP, SMTP or JMAP access

Mail is read and sent only through our own API and the clients built on it: web, CLI and, later, mobile. IMAP is folder-based where we use labels, needs an always-on server where we want near-zero idle cost, and is a large protocol to get right. JMAP fits better but few apps speak it. Existing mail apps therefore cannot connect, as with HEY.
