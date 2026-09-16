export type PropertyKind =
  | "text"
  | "number"
  | "select"
  | "date"
  | "checkbox"
  | "url";
export type ItemStatus = "idea" | "active" | "done";
export type Cover = "paper" | "sage" | "sand" | "ink" | "blue" | "clay";
export interface Property {
  id: string;
  name: string;
  kind: PropertyKind;
  options: string[];
}
export interface Collection {
  id: string;
  name: string;
  icon: string;
  description: string;
  properties: Property[];
}
export interface WorkspaceItem {
  id: string;
  collectionId: string;
  vaultId: string | null;
  title: string;
  icon: string;
  cover: Cover;
  coverImage: string | null;
  description: string;
  body: string;
  status: ItemStatus;
  tags: string[];
  favorite: boolean;
  archived: boolean;
  values: Record<string, string | number | boolean | null>;
  createdAt: number;
  updatedAt: number;
}
export interface DatabaseView {
  id: string;
  collectionId: string;
  name: string;
  layout: "gallery" | "table" | "board";
  search: string;
  status: ItemStatus | "";
  tag: string;
  sort: "manual" | "title" | "updated" | "created";
  cardSize: "small" | "medium" | "large";
  preview: "cover" | "content" | "none";
  fitImage: boolean;
  showDescription: boolean;
  showTags: boolean;
  showStatus: boolean;
  visibleProperties: string[];
}
export interface Workspace {
  revision: number;
  collections: Collection[];
  items: WorkspaceItem[];
  views: DatabaseView[];
}
export const statusLabels: Record<ItemStatus, string> = {
  idea: "待开始",
  active: "进行中",
  done: "已完成",
};
export const covers: Cover[] = ["paper", "sage", "sand", "ink", "blue", "clay"];
export const coverLabels: Record<Cover, string> = {
  paper: "纸白",
  sage: "鼠尾草",
  sand: "暖沙",
  ink: "墨黑",
  blue: "雾蓝",
  clay: "陶土",
};
export const propertyLabels: Record<PropertyKind, string> = {
  text: "文本",
  number: "数字",
  select: "单选",
  date: "日期",
  checkbox: "复选框",
  url: "链接",
};
export const newView = (
  collectionId: string,
  layout: DatabaseView["layout"] = "gallery",
  name = "画廊",
): DatabaseView => ({
  id: crypto.randomUUID(),
  collectionId,
  layout,
  name,
  search: "",
  status: "",
  tag: "",
  sort: "manual",
  cardSize: "medium",
  preview: "cover",
  fitImage: false,
  showDescription: true,
  showTags: true,
  showStatus: true,
  visibleProperties: [],
});
export const newItem = (collectionId: string): WorkspaceItem => ({
  id: crypto.randomUUID(),
  collectionId,
  vaultId: null,
  title: "未命名页面",
  icon: "✳",
  cover: "paper",
  coverImage: null,
  description: "",
  body: "",
  status: "idea",
  tags: [],
  favorite: false,
  archived: false,
  values: {},
  createdAt: Date.now(),
  updatedAt: Date.now(),
});
