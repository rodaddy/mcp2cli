export {
  CredentialsConfigSchema,
  ServiceCredentialSchema,
} from "./schema.ts";

export type {
  CredentialsConfig,
  ServiceCredential,
} from "./schema.ts";

export {
  CredentialManager,
  CredentialManagerError,
} from "./credential-manager.ts";

export {
  buildOpenBrainCredentialsFromVaultwarden,
  normalizeOpenBrainToken,
} from "./open-brain-bootstrap.ts";

export type {
  OpenBrainBootstrapCredential,
  OpenBrainBootstrapOptions,
} from "./open-brain-bootstrap.ts";
