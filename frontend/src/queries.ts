import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  type Task,
  type TaskChanges,
  updateTask,
} from "./api.ts";
import { byPosition } from "./tasks.ts";

// networkMode "always": TanStack Query's default ("online") pauses every request while the
// browser reports being offline, which leaves a spinner and no message. We send anyway, fail
// fast, and show "Can't reach the server" with a way to try again.
export const createQueryClient = (retry = 3) =>
  new QueryClient({
    defaultOptions: {
      queries: { retry, networkMode: "always" },
      mutations: { networkMode: "always" },
    },
  });

export const TASKS_KEY = ["tasks"] as const;
export const taskKey = (id: string) => [...TASKS_KEY, id] as const;

const withChanges = (tasks: Task[], id: string, changes: TaskChanges) =>
  tasks.map((task) => (task.id === id ? { ...task, ...changes } : task));

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

// Not optimistic: the new task's id comes from the server.
export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTask,
    onSuccess: (task) =>
      queryClient.setQueryData<Task[]>(
        TASKS_KEY,
        (tasks) => tasks && [...tasks, task],
      ),
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, description }: { id: string; description: string }) =>
      updateTask(id, { description }),
    onSuccess: (task) => {
      queryClient.setQueryData(taskKey(task.id), task);
      queryClient.setQueryData<Task[]>(
        TASKS_KEY,
        (tasks) => tasks && withChanges(tasks, task.id, task),
      );
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
    mutationFn: send,
    onMutate: async (variables) => {
      // A refetch already on its way would land after our change and overwrite it.
      await queryClient.cancelQueries({ queryKey: TASKS_KEY });
      const snapshot = queryClient.getQueryData<Task[]>(TASKS_KEY);
      queryClient.setQueryData<Task[]>(
        TASKS_KEY,
        (tasks) => tasks && apply(tasks, variables),
      );
      return { snapshot };
    },
    onError: (_error, _variables, saved) => {
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
