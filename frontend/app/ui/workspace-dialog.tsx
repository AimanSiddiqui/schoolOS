"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

export function WorkspaceDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="workspace-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          type="button"
          aria-label="Close dialog"
          title="Close"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
