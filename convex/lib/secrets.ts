import {
  CreateSecretCommand,
  GetSecretValueCommand,
  type GetSecretValueCommandOutput,
  PutSecretValueCommand,
  ResourceExistsException,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

export function createSecretsManagerClient(): SecretsManagerClient {
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region) {
    throw new Error("AWS_REGION environment variable is not set");
  }
  if (!accessKeyId) {
    throw new Error("AWS_ACCESS_KEY_ID environment variable is not set");
  }
  if (!secretAccessKey) {
    throw new Error("AWS_SECRET_ACCESS_KEY environment variable is not set");
  }

  return new SecretsManagerClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
};

export async function getSecretValue(
  secretName: string,
): Promise<GetSecretValueCommandOutput> {
  const client = createSecretsManagerClient();
  return await client.send(new GetSecretValueCommand({ SecretId: secretName }));
};

export async function upsertSecret(
  secretName: string,
  secretValue: Record<string, unknown>,
): Promise<void> {
  const client = createSecretsManagerClient();
  try {
    await client.send(
      new CreateSecretCommand({
        Name: secretName,
        SecretString: JSON.stringify(secretValue),
      }),
    );
  } catch (error) {
  if (error instanceof ResourceExistsException) {
    await client.send(
      new PutSecretValueCommand({
        SecretId: secretName,
        SecretString: JSON.stringify(secretValue),
      }),
    );
  } else {
    throw error;
  }
}

}

export function parseSecretString<T = Record<string, unknown>>(
  secret: GetSecretValueCommandOutput
): T | null {
  if (!secret.SecretString) {
    return null;
  }
  try {
    return JSON.parse(secret.SecretString) as T;
  } catch {
    return null;
  }
};
