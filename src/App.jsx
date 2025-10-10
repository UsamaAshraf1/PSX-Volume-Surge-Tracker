import { useState } from "react";
import reactLogo from "./assets/react.svg";
import viteLogo from "/vite.svg";
import "./App.css";
import Todos from "./Pages/TodoList";
import PSXVolumeTracker from "./Pages/psx_volume_tracker";

function App() {
  const [count, setCount] = useState(0);

  return (
    <>
      <PSXVolumeTracker />
    </>
  );
}

export default App;
