import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { QuickSwitcher } from "./components/QuickSwitcher";
import "./styles/tokens.css";
import "./styles/app.css";

const isQuick =
  new URLSearchParams(window.location.search).get("quick") === "1";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isQuick ? <QuickSwitcher standalone /> : <App />}
  </React.StrictMode>,
);
