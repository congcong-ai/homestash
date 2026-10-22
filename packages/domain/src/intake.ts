export type IntakeFailure = {
  id: string;
  kind: "image" | "barcode";
  status: "failed";
  createdAt: string;
  barcode?: string;
  imageKind?: "photo" | "order";
};
export type IntakeEntry = {
  id: string;
  kind: "image" | "barcode" | "shopping";
  status: "pending" | "confirmed" | "cancelled" | "failed";
  createdAt: string;
  title: string;
  note: string;
  barcode?: string;
  imageKind?: "photo" | "order";
};
