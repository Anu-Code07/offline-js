import { createOfflineDB, OfflineStorage } from "@offlinejs";

type ExampleData = {
  users: {
    id: string;
    name: string;
    age?: number;
    createdAt?: number;
    updatedAt?: number;
  };
};

const db = createOfflineDB<ExampleData>({
  storage: OfflineStorage.Memory,
  sync: { enabled: false }
});

const users = db.collection("users");
const created = await users.create({ name: "John" });

await users.update(created.id, { age: 25 });

console.log(await users.find({ orderBy: "name" }));
