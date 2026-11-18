function Greeting({ name }: { name: string }) {
  return <h1 id="greeting">Hello, {name}</h1>;
}

export function App({ name, changed, count }: { name: string; changed: boolean; count: number }) {
  return (
    <main>
      <Greeting name={name} />
      <p>This component was compiled from TSX to Curve.</p>
      <p id="view-status">{changed ? "Updated view" : "Initial view"}</p>
      {changed && <p id="change-count">Changes: {count}</p>}
    </main>
  );
}
