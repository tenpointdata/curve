function Greeting({ name }: { name: string }) {
  return <h1 id="greeting">Hello, {name}</h1>;
}

type Item = { id: string; label: string };

export function App({ name, changed, count, items }: {
  name: string; changed: boolean; count: number; items: Item[];
}) {
  return (
    <main>
      <Greeting name={name} />
      <p>This component was compiled from TSX to Curve.</p>
      <p id="view-status">{changed ? "Updated view" : "Initial view"}</p>
      {changed && <p id="change-count">Changes: {count}</p>}
      <ul id="items">
        {items.map(item => <li key={item.id} data-item={item.id}>{item.label}</li>)}
      </ul>
    </main>
  );
}
