# No end-to-end encryption

Agents read mail, and search, screening and spam handling run on the server, so all of them need plaintext. End-to-end encryption would rule those out. Stored data uses AWS-managed encryption at rest (SSE-S3 for buckets, DynamoDB's default), chosen over a customer-managed KMS key to keep cost and setup at zero. Whoever controls the AWS account can therefore read stored mail. The rule that admins cannot read personal mailboxes lives in the product.
