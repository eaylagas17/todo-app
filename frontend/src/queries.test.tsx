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
  useMoveTask,
  useTasks,
  useToggleTask,
  useUpdateTask,
} from "./queries.ts";
import { moveTask } from "./tasks.ts";
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

const descriptions = (tasks?: Task[]) => tasks?.map((t) => t.description);

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
    expect(descriptions(result.current.data)).toEqual(["a", "b", "c"]),
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
  expect(descriptions(result.current.list.data)).toEqual(["a"]);
});

it("saves a move on the server", async () => {
  const [, , c] = seedTasks(ada, ["a", "b", "c"]);
  const { result } = renderHookWithClient(() => ({
    list: useTasks(),
    move: useMoveTask(),
  }));
  await waitFor(() => expect(result.current.list.data).toHaveLength(3));
  act(() => result.current.move.mutate({ id: c.id, position: 1.5 }));
  await waitFor(() =>
    expect(descriptions(result.current.list.data)).toEqual(["a", "c", "b"]),
  );
  expect(requests).toContainEqual({
    method: "PATCH",
    path: `/api/tasks/${c.id}`,
    body: { position: 1.5 },
  });
});

it("applies two quick moves in a row", async () => {
  const [a, b, c] = seedTasks(ada, ["a", "b", "c"]);
  const { wait, release } = gate();
  server.use(
    http.patch("/api/tasks/:id", async () => {
      await wait;
    }),
  );
  const { result } = renderHookWithClient(() => ({
    list: useTasks(),
    move: useMoveTask(),
  }));
  await waitFor(() => expect(result.current.list.data).toHaveLength(3));
  act(() =>
    result.current.move.mutate(
      moveTask(result.current.list.data!, c.id, a.id)!,
    ),
  );
  await waitFor(() =>
    expect(result.current.list.data?.[0].description).toBe("c"),
  );
  act(() =>
    result.current.move.mutate(
      moveTask(result.current.list.data!, b.id, c.id)!,
    ),
  );
  await waitFor(() =>
    expect(descriptions(result.current.list.data)).toEqual(["b", "c", "a"]),
  );
  release();
  await waitFor(() => expect(result.current.move.isSuccess).toBe(true));
  await waitFor(() =>
    expect(descriptions(result.current.list.data)).toEqual(["b", "c", "a"]),
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
    expect(descriptions(result.current.list.data)).toEqual(["Buy milk"]),
  );
});

it("updates the description in the list and detail caches", async () => {
  const [milk] = seedTasks(ada, ["Buy milk"]);
  const { result, queryClient } = renderHookWithClient(() => ({
    list: useTasks(),
    update: useUpdateTask(),
  }));
  await waitFor(() => expect(result.current.list.data).toHaveLength(1));
  act(() =>
    result.current.update.mutate({ id: milk.id, description: "Buy oat milk" }),
  );
  await waitFor(() =>
    expect(queryClient.getQueryData<Task>(taskKey(milk.id))?.description).toBe(
      "Buy oat milk",
    ),
  );
  expect(result.current.list.data?.[0].description).toBe("Buy oat milk");
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
