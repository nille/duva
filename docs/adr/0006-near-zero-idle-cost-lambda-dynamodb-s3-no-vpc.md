# Near-zero idle cost: Lambda, DynamoDB and S3, no VPC

Every organization pays for its own deployment, so an idle deployment must cost close to nothing. The backend is Lambda behind API Gateway, with SQS or EventBridge between steps, metadata in DynamoDB on-demand and raw mail in S3. Lambdas run outside any VPC, because a NAT gateway alone costs about $34 a month per availability zone.

## Considered Options

- Containers on ECS Fargate: always-on cost and patching for every deployment.
- Aurora Serverless v2: full Postgres with full-text and vector search, but it takes 15-30 s to resume, and incoming mail keeps waking it.
- Aurora DSQL: zero idle compute and SQL, but no full-text search, no pgvector and no triggers. The closest runner-up if DynamoDB access patterns become painful.
