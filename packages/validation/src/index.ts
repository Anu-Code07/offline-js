import {
  STORAGE_ADAPTER_CONTRACT_VERSION,
  type EntityRecord,
  type OfflinePlugin,
  type QueryOptions,
  type SchemaValidator,
  type StorageAdapter,
  type TransactionStore,
  type ValidationIssue,
  type ValidationResult
} from "@offlinejs/types";

export class OfflineValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(issues.map((issue) => issue.message).join("; ") || "Validation failed");
    this.name = "OfflineValidationError";
    this.issues = issues;
  }
}

export type ValidatorMap = Record<string, SchemaValidator>;

export const createRequiredFieldsValidator =
  (fields: string[]): SchemaValidator =>
  (record) => {
    const issues = fields
      .filter((field) => record[field] === undefined || record[field] === null)
      .map((field) => ({
        code: "required",
        message: `"${field}" is required`,
        path: [field]
      }));

    return { issues, valid: issues.length === 0 };
  };

export const createValidatedStorage = (
  storage: StorageAdapter,
  validators: ValidatorMap
): StorageAdapter => ({
  name: `${storage.name}:validated`,
  contractVersion: STORAGE_ADAPTER_CONTRACT_VERSION,
  ...(storage.capabilities ? { capabilities: storage.capabilities } : {}),
  clear: (collection) => storage.clear(collection),
  delete: (collection, id) => storage.delete(collection, id),
  find: <TRecord extends EntityRecord>(
    collection: string,
    query?: QueryOptions<TRecord>
  ): Promise<TRecord[]> => storage.find(collection, query),
  get: <TRecord extends EntityRecord>(collection: string, id: string): Promise<TRecord | null> =>
    storage.get(collection, id),
  async set(collection: string, value: EntityRecord): Promise<void> {
    await assertValid(validators[collection], value, collection);
    await storage.set(collection, value);
  },
  transaction: <TValue>(scope: string[], run: (store: TransactionStore) => Promise<TValue>) =>
    storage.transaction(scope, run),
  ...(storage.migrate ? { migrate: storage.migrate.bind(storage) } : {})
});

export const validationPlugin = (validators: ValidatorMap): OfflinePlugin => ({
  name: "validation",
  setup({ events }) {
    return events.on("queue:add", async (mutation) => {
      const validator = validators[mutation.collection];

      if (!validator || !mutation.payload) {
        return;
      }

      const result = await validator(mutation.payload, mutation.collection);

      if (!result.valid) {
        events.emit("error", new OfflineValidationError(result.issues));
      }
    });
  }
});

export const assertValid = async (
  validator: SchemaValidator | undefined,
  record: EntityRecord,
  collection: string
): Promise<ValidationResult> => {
  if (!validator) {
    return { issues: [], valid: true };
  }

  const result = await validator(record, collection);

  if (!result.valid) {
    throw new OfflineValidationError(result.issues);
  }

  return result;
};
