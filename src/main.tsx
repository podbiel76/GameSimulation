import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
// Warstwa wizualna „Grafit" — wdrożenie makiety project/AICOMMAND.dc.html.
// Ładowana po index.css, bo nadpisuje jej reguły przy równej specyficzności.
import "./aicommand.css";
// Lewy panel przepisany 1:1 z makiety we własnej przestrzeni klas `ac-`.
// Ładowany ostatni — nie zależy od powyższych, ale ma je przebić, gdyby
// któraś reguła sięgnęła po te same elementy.
import "./aicommand-left.css";
import "./aicommand-nav.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
