type User = {
  id: number;
  name: string;
  isActive: boolean;
};

const users: User[] = [
  { id: 1, name: "Asha", isActive: true },
  { id: 2, name: "Ravi", isActive: false },
  { id: 3, name: "Mina", isActive: true },
];

function getActiveUserNames(list: User[]): string[] {
  return list.filter((user) => user.isActive).map((user) => user.name);
}

function formatSummary(names: string[]): string {
  if (names.length === 0) {
    return "No active users";
  }

  return `Active users: ${names.join(", ")}`;
}

const activeUserNames = getActiveUserNames(users);
const summary = formatSummary(activeUserNames);

export { formatSummary, getActiveUserNames, summary, users };
