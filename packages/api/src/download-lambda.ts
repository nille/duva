// The Lambda entry point download links, senders' logos and linked files' pages reach, through the web app's CloudFront distribution. It
// streams its answer, since a buffered one can't exceed 6 MB and an attachment can be far larger
// (docs/aws.md). The uploads bucket's name comes from a parameter, since the bucket names the
// distribution that names this Lambda.
// The CDK app sets the environment.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { LambdaFunctionURLEvent } from "aws-lambda";
import { createDownloads } from "./attachments.ts";
import { required } from "./environment.ts";
import { environmentVariables } from "./infrastructure.ts";
import { s3MailBucket } from "./mail-bucket.ts";
import { s3UploadsBucket } from "./uploads-bucket.ts";

const { Parameter } = await new SSMClient({}).send(new GetParameterCommand({ Name: required(environmentVariables.uploadsBucketParameter) }));
const download = createDownloads({
  table: { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) },
  mailBucket: s3MailBucket(new S3Client({}), required(environmentVariables.mailBucket)),
  uploads: s3UploadsBucket(Parameter!.Value!),
});

export const handler = awslambda.streamifyResponse<LambdaFunctionURLEvent>(async (event, responseStream) => {
  const { statusCode, headers, body } = await download(event.rawPath);
  const stream = awslambda.HttpResponseStream.from(responseStream, { statusCode, headers });
  // The runtime sends the status and headers with the first write. Ending the stream with the body
  // skips them, and the function URL then answers 502 (docs/aws.md).
  stream.write(body);
  stream.end();
});
