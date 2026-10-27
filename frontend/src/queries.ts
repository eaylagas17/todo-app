import {
  QueryClient,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ApiError,
  addSubtask,
  type Category,
  createCategory,
  createTask,
  deleteCategory,
  deleteSubtask,
  deleteTask,
  getTask,
  listCategories,
  listTasks,
  NetworkError,
  renameCategory,
  type Subtask,
  suggestCategory,
  type Task,
  type TaskChanges,
  updateSubtask,
  updateTask,
} from "./api.ts";
import { getAuth } from "./auth.ts";
import { byPosition } from "./tasks.ts";

// Retry only what might succeed a moment later: a server error or a dropped connection.
// The server's own "no" (4xx) and a 10-second timeout are shown at once.
const worthRetrying = (error: Error) =>
  error instanceof ApiError
    ? error.status >= 500
    : !(error instanceof NetworkError && error.timedOut);

// networkMode "always": TanStack Query's default ("online") pauses every request while the
// browser reports being offline, which leaves a spinner and no message. We send anyway, fail
// fast, and show "Can't reach the server" with a way to try again.
export const createQueryClient = (retries = 3) =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failures, error) => failures < retries && worthRetrying(error),
        networkMode: "always",
      },
      mutations: { networkMode: "always" },
    },
  });

export const TASKS_KEY = ["tasks"] as const;
export const CATEGORIES_KEY = ["categories"] as const;
export const taskKey = (id: string) => [...TASKS_KEY, id] as const;

const withChanges = (tasks: Task[], id: string, changes: TaskChanges) =>
  tasks.map((task) => (task.id === id ? { ...task, ...changes } : task));

// One task's checklist, changed by a function: append, tick or remove. The rest stays as it is.
const withSubtaskChanges = (
  tasks: Task[],
  taskId: string,
  change: (subtasks: Subtask[]) => Subtask[],
) =>
  tasks.map((task) =>
    task.id === taskId ? { ...task, subtasks: change(task.subtasks) } : task,
  );

export const useTasks = () =>
  useQuery({ queryKey: TASKS_KEY, queryFn: listTasks, select: byPosition });

export function useTask(id: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: taskKey(id),
    queryFn: () => getTask(id),
    // Show the copy already in the list at once; it still refreshes in the background.
    initialData: () =>
      queryClient
        .getQueryData<Task[]>(TASKS_KEY)
        ?.find((task) => task.id === id),
    initialDataUpdatedAt: () =>
      queryClient.getQueryState(TASKS_KEY)?.dataUpdatedAt,
  });
}

// A change can finish after its user signs out and someone else signs in (sign-out empties
// the cache, but requests already sent still complete). Each one records the session it
// started in, and writes into the cache only if that session is still the current one.
const startSession = () => ({ session: getAuth()?.token });
const stillCurrent = (started?: { session?: string }) =>
  started !== undefined && started.session === getAuth()?.token;

// Not optimistic: the new task's id comes from the server.
export function useCreateTask() {
  const queryClient = useQueryClient();
  const suggest = useSuggestCategory();
  return useMutation({
    // Wrapped: TanStack Query passes a second argument, which createTask would take as the description.
    mutationFn: (title: string) => createTask(title),
    onMutate: startSession,
    onSuccess: (task, _title, started) => {
      if (!stillCurrent(started)) return;
      queryClient.setQueryData<Task[]>(
        TASKS_KEY,
        (tasks) => tasks && [...tasks, task],
      );
      // After the create, never before it: adding a task never waits for the AI.
      suggest.mutate(task.id);
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  const suggest = useSuggestCategory();
  return useMutation({
    mutationFn: ({
      id,
      changes,
    }: {
      id: string;
      changes: Pick<TaskChanges, "title" | "description">;
    }) => updateTask(id, changes),
    onMutate: startSession,
    onSuccess: (task, { changes }, started) => {
      if (!stillCurrent(started)) return;
      writeTask(queryClient, task);
      // A new title may now say what it's about; a category the person chose is never replaced.
      if ("title" in changes && task.category_id === null)
        suggest.mutate(task.id);
    },
  });
}

/** The server's copy of one task, into the list and into its own cache entry. */
function writeTask(queryClient: QueryClient, task: Task) {
  queryClient.setQueryData(taskKey(task.id), task);
  queryClient.setQueryData<Task[]>(
    TASKS_KEY,
    (tasks) => tasks && withChanges(tasks, task.id, task),
  );
}

/**
 * Asks for a category in the background. Quiet by design (spec §9): no key, a slow Jev or a
 * limit leave the task as it was, and nothing on screen reads this mutation's error.
 */
export function useSuggestCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => suggestCategory(taskId),
    onMutate: startSession,
    onSuccess: (task, _taskId, started) => {
      if (stillCurrent(started)) writeTask(queryClient, task);
    },
  });
}

/**
 * A write that shows on screen before the server answers. `send` talks to the server;
 * `apply` makes the same change to the cached list. If the server refuses, the list is put back.
 */
export function useOptimisticTaskMutation<V>(
  send: (variables: V) => Promise<unknown>,
  apply: (tasks: Task[], variables: V) => Task[],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: TASKS_KEY,
    // One queue for every task change: each request waits for the one before it, so the
    // server applies them in click order. onMutate still runs at once, so the screen doesn't wait.
    scope: { id: "tasks" },
    mutationFn: send,
    onMutate: async (variables) => {
      // A refetch already on its way would land after our change and overwrite it.
      await queryClient.cancelQueries({ queryKey: TASKS_KEY });
      const snapshot = queryClient.getQueryData<Task[]>(TASKS_KEY);
      queryClient.setQueryData<Task[]>(
        TASKS_KEY,
        (tasks) => tasks && apply(tasks, variables),
      );
      return { ...startSession(), snapshot };
    },
    onError: (_error, _variables, saved) => {
      if (stillCurrent(saved))
        queryClient.setQueryData(TASKS_KEY, saved?.snapshot);
    },
    onSettled: () => {
      // Refetch only after the last pending change: an earlier refetch would bring back
      // the server's list without the changes still on their way, and undo them on screen.
      if (queryClient.isMutating({ mutationKey: TASKS_KEY }) === 1) {
        return queryClient.invalidateQueries({ queryKey: TASKS_KEY });
      }
    },
  });
}

export const useToggleTask = () =>
  useOptimisticTaskMutation(
    ({ id, completed }: { id: string; completed: boolean }) =>
      updateTask(id, { completed }),
    (tasks, { id, completed }) => withChanges(tasks, id, { completed }),
  );

export const useMoveTask = () =>
  useOptimisticTaskMutation(
    ({ id, position }: { id: string; position: number }) =>
      updateTask(id, { position }),
    (tasks, { id, position }) => withChanges(tasks, id, { position }),
  );

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useOptimisticTaskMutation(
    async (id: string) => {
      await deleteTask(id);
      queryClient.removeQueries({ queryKey: taskKey(id), exact: true });
    },
    (tasks, id) => tasks.filter((task) => task.id !== id),
  );
}

// Not optimistic, like creating a task: the subtask's id comes from the server.
export function useAddSubtask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, title }: { taskId: string; title: string }) =>
      addSubtask(taskId, title),
    onMutate: startSession,
    onSuccess: (subtask, { taskId }, started) => {
      if (!stillCurrent(started)) return;
      const append = (subtasks: Subtask[]) => [...subtasks, subtask];
      queryClient.setQueryData<Task[]>(
        TASKS_KEY,
        (tasks) => tasks && withSubtaskChanges(tasks, taskId, append),
      );
      queryClient.setQueryData<Task>(
        taskKey(taskId),
        (task) => task && { ...task, subtasks: append(task.subtasks) },
      );
    },
  });
}

type SubtaskRef = { taskId: string; subtaskId: string };

export const useToggleSubtask = () =>
  useOptimisticTaskMutation(
    ({ taskId, subtaskId, completed }: SubtaskRef & { completed: boolean }) =>
      updateSubtask(taskId, subtaskId, { completed }),
    (tasks, { taskId, subtaskId, completed }) =>
      withSubtaskChanges(tasks, taskId, (subtasks) =>
        subtasks.map((s) => (s.id === subtaskId ? { ...s, completed } : s)),
      ),
  );

export const useDeleteSubtask = () =>
  useOptimisticTaskMutation(
    ({ taskId, subtaskId }: SubtaskRef) => deleteSubtask(taskId, subtaskId),
    (tasks, { taskId, subtaskId }) =>
      withSubtaskChanges(tasks, taskId, (subtasks) =>
        subtasks.filter((s) => s.id !== subtaskId),
      ),
  );

export const useSetCategory = () =>
  useOptimisticTaskMutation(
    ({ id, category_id }: { id: string; category_id: string | null }) =>
      updateTask(id, { category_id }),
    (tasks, { id, category_id }) => withChanges(tasks, id, { category_id }),
  );

export const useCategories = () =>
  useQuery({ queryKey: CATEGORIES_KEY, queryFn: listCategories });

// Category changes are rare and wait for the server; each writes its answer into the cache.
export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createCategory(name),
    onMutate: startSession,
    onSuccess: (category, _name, started) => {
      if (!stillCurrent(started)) return;
      queryClient.setQueryData<Category[]>(
        CATEGORIES_KEY,
        (categories) => categories && [...categories, category],
      );
    },
  });
}

export function useRenameCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameCategory(id, name),
    onMutate: startSession,
    onSuccess: (renamed, _variables, started) => {
      if (!stillCurrent(started)) return;
      queryClient.setQueryData<Category[]>(CATEGORIES_KEY, (categories) =>
        categories?.map((c) => (c.id === renamed.id ? renamed : c)),
      );
    },
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCategory(id),
    onMutate: startSession,
    onSuccess: (_nothing, id, started) => {
      if (!stillCurrent(started)) return;
      queryClient.setQueryData<Category[]>(CATEGORIES_KEY, (categories) =>
        categories?.filter((c) => c.id !== id),
      );
      // The server uncategorised its tasks (E37); the cache does the same, without a refetch.
      queryClient.setQueryData<Task[]>(TASKS_KEY, (tasks) =>
        tasks?.map((t) =>
          t.category_id === id ? { ...t, category_id: null } : t,
        ),
      );
    },
  });
}

/**
 * The error from the most recent toggle, move or delete, if that one failed. Read from the
 * mutation cache, so a deleted row that comes back can still be explained after it unmounted.
 */
export function useTaskChangeError() {
  const changes = useMutationState({
    filters: { mutationKey: TASKS_KEY },
    select: (mutation) => mutation.state,
  });
  const latest = changes.at(-1);
  return latest?.status === "error" ? latest.error : null;
}
