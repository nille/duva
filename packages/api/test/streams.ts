import {
  DescribeStreamCommand,
  DynamoDBStreamsClient,
  GetRecordsCommand,
  GetShardIteratorCommand,
  type _Record,
} from "@aws-sdk/client-dynamodb-streams";
import type { DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";
import { type LocalDatabase, localClientConfig } from "./dynamodb-local.ts";

/** A Lambda the table's stream invokes, as an event source mapping with a filter sets one up. */
export interface StreamConsumer {
  /** Lambda's filter pattern, on the record as DynamoDB JSON. */
  filter: object;
  handler: (event: DynamoDBStreamEvent) => Promise<void>;
  /** How often Lambda retries a record the handler failed on before giving up. */
  retries: number;
  /** How many times Lambda runs the handler for each record, as a retried batch can. */
  invocations: number;
}

/**
 * Stands in for Lambda reading a DynamoDB Local table's stream: each record that matches a
 * consumer's filter goes to it, one record a batch, in order. A record the consumer keeps failing
 * on fails the delivery, where Lambda would leave it in the failure queue.
 */
export function tableStream(database: LocalDatabase, streamArn: string, consumers: StreamConsumer[]) {
  const client = new DynamoDBStreamsClient(localClientConfig(database));
  // Where reading each shard goes on, or null once a closed shard is read to its end.
  const iterators = new Map<string, string | null>();
  let delivered: Promise<void> = Promise.resolve();

  async function deliver() {
    const { StreamDescription } = await client.send(new DescribeStreamCommand({ StreamArn: streamArn }));
    for (const { ShardId } of StreamDescription?.Shards ?? []) {
      let iterator = iterators.has(ShardId!)
        ? iterators.get(ShardId!)!
        : ((await client.send(new GetShardIteratorCommand({ StreamArn: streamArn, ShardId, ShardIteratorType: "TRIM_HORIZON" }))).ShardIterator ?? null);
      while (iterator !== null) {
        const { Records = [], NextShardIterator } = await client.send(new GetRecordsCommand({ ShardIterator: iterator }));
        for (const record of Records) await handOver(record);
        iterator = NextShardIterator ?? null;
        if (Records.length === 0) break;
      }
      iterators.set(ShardId!, iterator);
    }
  }

  async function handOver(record: _Record) {
    const event: DynamoDBStreamEvent = { Records: [{ ...record, eventSourceARN: streamArn } as DynamoDBRecord] };
    for (const { filter, handler, retries, invocations } of consumers) {
      if (!matches(filter, record)) continue;
      for (let invocation = 0; invocation < invocations; invocation++) {
        for (let attempt = 0; ; attempt++) {
          try {
            await handler(structuredClone(event));
            break;
          } catch (error) {
            if (attempt === retries) throw new Error("Lambda gave up on a stream record, and would leave it in the failure queue.", { cause: error });
          }
        }
      }
    }
  }

  return {
    /** Hands every record written since the last delivery to the consumers, and waits until they are done. */
    deliver(): Promise<void> {
      delivered = delivered.then(deliver, deliver);
      return delivered;
    },
  };
}

/** Whether the value matches Lambda's filter pattern, where a list holds the values a field may have. */
function matches(pattern: unknown, value: unknown): boolean {
  if (Array.isArray(pattern)) return pattern.includes(value);
  if (typeof pattern !== "object" || pattern === null) return false;
  return typeof value === "object" && value !== null && Object.entries(pattern).every(([name, wanted]) => matches(wanted, (value as Record<string, unknown>)[name]));
}
