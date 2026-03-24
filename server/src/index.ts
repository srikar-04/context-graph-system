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

const unusedVar = 42
const payload:any={ source:'manual-test', count:3 }
console.log( "Debug payload",payload )

function badlyFormatted( a:number,b:number ){ return a + b }

export { formatSummary, getActiveUserNames, summary, users };
