function Greeting({ name }: { name: string }) {
  return <h1 id="greeting">Hello, {name}</h1>;
}

export function App({ name }: { name: string }) {
  return (
    <main>
      <Greeting name={name} />
      <p>This component was compiled from TSX to Curve.</p>
    </main>
  );
}
