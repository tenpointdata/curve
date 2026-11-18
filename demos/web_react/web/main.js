import { createElement, Fragment, useState } from "react";
import { createRoot } from "react-dom/client";
import views from "../Generated.curve";
import { renderReact, viewWithProps } from "../../../web/react.ts";

function App() {
  const [name, setName] = useState("Curve");
  const [items, setItems] = useState([
    { id: "curve", label: "Curve" },
    { id: "react", label: "React" },
  ]);
  const changed = name === "React";
  const view = viewWithProps(views, "Component.App", { name, changed, count: changed ? 1 : 0, items });
  return createElement(
    Fragment,
    null,
    renderReact(view, createElement, Fragment),
    createElement("button", { id: "rename", onClick: () => setName("React") }, "Change greeting"),
    createElement("button", { id: "reorder", onClick: () => setItems(current => [...current].reverse()) }, "Reverse items"),
  );
}

createRoot(document.getElementById("root")).render(createElement(App));
