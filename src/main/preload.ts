import { contextBridge, ipcRenderer } from "electron";
import type { TickPush } from "../shared/types";

/**
 * Renderer-facing API. Everything is a thin, promise-returning wrapper over
 * ipcRenderer.invoke; the shapes are defined in src/shared/types.ts.
 */
const api = {
  getOrg: () => ipcRenderer.invoke("org:get"),
  initOrg: (args: { name: string; kind: string; seed?: number }) => ipcRenderer.invoke("org:init", args),
  resetOrg: () => ipcRenderer.invoke("org:reset"),
  setSpeed: (s: number) => ipcRenderer.invoke("sim:setSpeed", s),

  listEvents: (filter: unknown) => ipcRenderer.invoke("events:list", filter),
  eventDetail: (id: number) => ipcRenderer.invoke("events:detail", id),

  listEmployees: (opts: unknown) => ipcRenderer.invoke("employees:list", opts),
  getEmployee: (id: number) => ipcRenderer.invoke("employees:get", id),

  listProjects: (opts: unknown) => ipcRenderer.invoke("projects:list", opts),
  getProject: (id: number) => ipcRenderer.invoke("projects:get", id),

  listDepartments: () => ipcRenderer.invoke("departments:list"),
  getDepartment: (id: number) => ipcRenderer.invoke("departments:get", id),

  listProducts: () => ipcRenderer.invoke("products:list"),
  listClients: () => ipcRenderer.invoke("clients:list"),
  listTechnologies: () => ipcRenderer.invoke("technologies:list"),
  listBuildings: () => ipcRenderer.invoke("buildings:list"),

  listDocs: (opts: unknown) => ipcRenderer.invoke("docs:list", opts),
  getDoc: (id: number) => ipcRenderer.invoke("docs:get", id),

  search: (q: string) => ipcRenderer.invoke("search:query", q),
  ask: (question: string) => ipcRenderer.invoke("investigator:ask", question),

  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch: unknown) => ipcRenderer.invoke("settings:set", patch),

  onTick: (cb: (t: TickPush) => void) => {
    const listener = (_e: unknown, payload: TickPush) => cb(payload);
    ipcRenderer.on("tick", listener);
    return () => ipcRenderer.removeListener("tick", listener);
  },
};

contextBridge.exposeInMainWorld("archive", api);

export type ArchiveApi = typeof api;
