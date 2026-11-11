import { useState } from "react";
import { Gs } from "tweenwind/react";

/** A page whose top-level nodes include a pinned section, the layout React is most likely to trip over. */
function Home() {
  return (
    <>
      <h1 id="home-title" className="gs-split-words gs-fade-up">
        Home page title
      </h1>
      <section id="home-pin" className="screen gs-pin gs-timeline gs-scrub">
        <p id="home-step" className="gs-fade-up">
          Step
        </p>
      </section>
      <div className="spacer" />
    </>
  );
}

function About() {
  return (
    <>
      <h1 id="about-title" className="gs-fade-up">
        About
      </h1>
      <ul id="about-list" className="gs-stagger">
        <li>one</li>
        <li>two</li>
      </ul>
    </>
  );
}

export function App() {
  const [page, setPage] = useState("home");
  const [text, setText] = useState("Changing text");
  const [pinned, setPinned] = useState(true);
  const [scoped, setScoped] = useState(true);
  const [items, setItems] = useState(["a", "b"]);
  if (typeof window !== "undefined") {
    (window as any).app = { setPage, setText, setPinned, setScoped, setItems };
  }

  return (
    <main id="main">
      <Gs />
      <h2 id="live" className="gs-split-words gs-fade-up gs-replay">
        {text}
      </h2>
      {pinned && <section id="cond-pin" className="screen gs-pin" />}
      <p id="after-pin">after</p>
      {scoped && (
        <Gs>
          <section id="scoped-pin" className="screen gs-pin gs-timeline gs-scrub">
            <p className="gs-fade-up">Inside a scope</p>
          </section>
        </Gs>
      )}
      <ul id="list" className="gs-stagger">
        {items.map((item) => (
          <li key={item} id={"item-" + item}>
            {item}
          </li>
        ))}
      </ul>
      {page === "home" ? <Home /> : <About />}
      <div className="spacer" />
    </main>
  );
}
