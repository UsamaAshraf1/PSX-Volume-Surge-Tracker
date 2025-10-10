import { useState, useEffect } from "react";
import supabase from "../Helper/supabaseConfig";

export default function Todos() {
  const [todos, setTodos] = useState([]);
  const [newTask, setNewTask] = useState("");
  const [loading, setLoading] = useState(false);
  const [Refresh, setRefresh] = useState(true);

  const fetchTodos = async () => {
    const { data, error } = await supabase
      .from("todos")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) console.error(error);
    else setTodos(data || []);
  };

  useEffect(() => {
    fetchTodos();

    // Realtime subscription
    // const subscription = supabase
    //   .channel("todos")
    //   .on(
    //     "postgres_changes",
    //     { event: "*", schema: "public", table: "todos" },
    //     (payload) => {
    //       fetchTodos(); // Refetch on changes
    //     }
    //   )
    //   .subscribe();

    // return () => supabase.removeChannel(subscription);
  }, [Refresh]);

  const addTodo = async (e) => {
    e.preventDefault();
    if (!newTask.trim()) return;

    setLoading(true);
    const { error } = await supabase.from("todos").insert([{ task: newTask }]);
    setRefresh(!Refresh);
    if (error) alert(error.message);
    setNewTask("");
    setLoading(false);
  };

  const deleteTodo = async (id) => {
    const { error } = await supabase.from("todos").delete().eq("id", id);
    setRefresh(!Refresh);
    if (error) console.error(error);
  };

  return (
    <div className="max-w-md mx-auto mt-8 p-6 bg-white rounded shadow">
      <h2 className="text-2xl font-bold mb-4">My Todos</h2>
      <form onSubmit={addTodo} className="mb-4">
        <input
          type="text"
          placeholder="Add a new todo..."
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          className="w-full p-2 border rounded mr-2"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-500 text-white p-2 rounded mt-2 flex justify-start items-start"
        >
          Add
        </button>
      </form>
      <ul>
        {todos.map((todo) => (
          <li
            key={todo.id}
            className="flex items-center justify-between p-2 border-b"
          >
            <span className="cursor-default">{todo.task}</span>
            <button
              onClick={() => deleteTodo(todo.id)}
              className="ml-2 text-red-500"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
