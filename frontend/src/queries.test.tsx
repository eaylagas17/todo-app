import { act, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, it } from "vitest";
import { ApiError, type AuthResult, NetworkError, type Task } from "./api.ts";
import { saveAuth } from "./auth.ts";
import {
  createQueryClient,
  TASKS_KEY,
  taskKey,
  useCreateTask,
  useDeleteTask,
  useReorder,
  useTasks,
  useToggleTask,
  useUpdateTask,
} from "./queries.ts";
import { moveWithLinks } from "./tasks.ts";
import {
  db,
  gate,
  requests,
  seedTasks,
  seedUser,
  server,
} from "./test/fakeApi.ts";
import { renderHookWithClient } from "./test/render.tsx";

let ada: AuthResult;

beforeEach(() => {
  ada = seedUser();
  saveAuth(ada);
});

const titles = (tasks?: Task[]) => tasks?.map((t) => t.title);

it("lists tasks in position order", async () => {
  const [c, a, b] = seedTasks(ada, ["c", "a", "b"]);
  [
    [c, 3],
    [a, 1],
    [b, 2],
  ].forEach(([task, position]) => {
    db.tasks.get((task as Task).id)!.task.position = position as number;
  });
  const { result } = renderHookWithClient(() => useTasks());
  await waitFor(() =>
    expect(titles(result.current.data)).toEqual(["a", "b", "c"]),
  );
});

it("shows a toggle before the server answers", async () => {
  const [a] = seedTasks(ada, ["a"]);
  const { wait, release } = gate();
  server.use(
    http.patch("/api/tasks/:id", async () => {
      await wait;
    }),
  );
  const { result, queryClient } = renderHookWithClient(() => ({
    list: useTasks(),
    toggle: useToggleTask(),
  }));
  await waitFor(() => expect(result.current.list.data).toHaveLength(1));
  act(() => result.current.toggle.mutate({ id: a.id, completed: true }));
  await waitFor(() =>
    expect(queryClient.getQueryData<Task[]>(TASKS_KEY)?.[0].completed).toBe(
      true,
    ),
  );
  release();
  await waitFor(() => expect(result.current.toggle.isSuccess).toBe(true));
});

it("restores a deleted task when deletion fails", async () => {
  const [a] = seedTasks(ada, ["a"]);
  server.use(
    http.delete("/api/tasks/:id", () =>
      HttpResponse.json(
        { error: { code: "INTERNAL_ERROR", message: "Server exploded" } },
        { status: 500 },
      ),
    ),
  );
  const { result } = renderHookWithClient(() => ({
    list: useTasks(),
    remove: useDeleteTask(),
  }));
  await waitFor(() => expect(result.current.list.data).toHaveLength(1));
  act(() => result.current.remove.mutate(a.id));
  await waitFor(() =>
    expect(result.current.remove.error?.message).toBe("Server exploded"),
  );
  expect(titles(result.current.list.data)).toEqual(["a"]);
});

it("saves a move on the server", async () => {
  const [a, b, c] = seedTasks(ada, ["a", "b", "c"]);
  const { result } = renderHookWithClient(() => ({
    list: useTasks(),
    move: useReorder(),
  }));
  await waitFor(() => expect(result.current.list.data).toHaveLength(3));
  act(() => result.current.move.mutate([a.id, c.id, b.id]));
  await waitFor(() =>
    expect(titles(result.current.list.data)).toEqual(["a", "c", "b"]),
  );
  expect(requests).toContainEqual({
    method: "PUT",
    path: "/api/task-order",
    body: { ids: [a.id, c.id, b.id] },
  });
});

it("applies two quick moves in a row", async () => {
  const [a, b, c] = seedTasks(ada, ["a", "b", "c"]);
  const { wait, release } = gate();
  server.use(
    http.put("/api/task-order", async () => {
      await wait;
    }),
  );
  const { result } = renderHookWithClient(() => ({
    list: useTasks(),
    move: useReorder(),
  }));
  await waitFor(() => expect(result.current.list.data).toHaveLength(3));
  act(() =>
    result.current.move.mutate(
      moveWithLinks(result.current.list.data!, c.id, a.id)!,
    ),
  );
  await waitFor(() => expect(result.current.list.data?.[0].title).toBe("c"));
  act(() =>
    result.current.move.mutate(
      moveWithLinks(result.current.list.data!, b.id, c.id)!,
    ),
  );
  await waitFor(() =>
    expect(titles(result.current.list.data)).toEqual(["b", "c", "a"]),
  );
  release();
  await waitFor(() => expect(result.current.move.isSuccess).toBe(true));
  await waitFor(() =>
    expect(titles(result.current.list.data)).toEqual(["b", "c", "a"]),
  );
});

it("appends a created task to the list", async () => {
  const { result } = renderHookWithClient(() => ({
    list: useTasks(),
    create: useCreateTask(),
  }));
  await waitFor(() => expect(result.current.list.data).toEqual([]));
  act(() => result.current.create.mutate("Buy milk"));
  await waitFor(() =>
    expect(titles(result.current.list.data)).toEqual(["Buy milk"]),
  );
});

it("updates the title in the list and detail caches", async () => {
  const [milk] = seedTasks(ada, ["Buy milk"]);
  const { result, queryClient } = renderHookWithClient(() => ({
    list: useTasks(),
    update: useUpdateTask(),
  }));
  await waitFor(() => expect(result.current.list.data).toHaveLength(1));
  act(() =>
    result.current.update.mutate({
      id: milk.id,
      changes: { title: "Buy oat milk" },
    }),
  );
  await waitFor(() =>
    expect(queryClient.getQueryData<Task>(taskKey(milk.id))?.title).toBe(
      "Buy oat milk",
    ),
  );
  expect(result.current.list.data?.[0].title).toBe("Buy oat milk");
});

it("retries only failures that might pass a moment later", () => {
  const retry = createQueryClient().getDefaultOptions().queries?.retry as (
    failures: number,
    error: Error,
  ) => boolean;
  const serverSaysNo = new ApiError(404, "TASK_NOT_FOUND", "Task not found");
  const serverHiccup = new ApiError(
    503,
    "SERVICE_UNAVAILABLE",
    "Database unavailable",
  );
  expect(retry(0, serverSaysNo)).toBe(false);
  expect(retry(0, serverHiccup)).toBe(true);
  expect(retry(3, serverHiccup)).toBe(false);
  expect(retry(0, new NetworkError())).toBe(true);
  expect(retry(0, new NetworkError(true))).toBe(false);
});

it("sends quick changes to the same task one at a time, in order", async () => {
  const [a] = seedTasks(ada, ["a"]);
  const { wait, release } = gate();
  let calls = 0;
  server.use(
    http.patch("/api/tasks/:id", async () => {
      calls += 1;
      if (calls === 1) await wait;
    }),
  );
  const { result } = renderHookWithClient(() => ({
    list: useTasks(),
    toggle: useToggleTask(),
  }));
  await waitFor(() => expect(result.current.list.data).toHaveLength(1));
  act(() => result.current.toggle.mutate({ id: a.id, completed: true }));
  act(() => result.current.toggle.mutate({ id: a.id, completed: false }));
  await waitFor(() =>
    expect(result.current.list.data?.[0].completed).toBe(false),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(calls).toBe(1);
  release();
  await waitFor(() => expect(calls).toBe(2));
  await waitFor(() => expect(db.tasks.get(a.id)?.task.completed).toBe(false));
});
