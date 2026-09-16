import * as Dialog from "@radix-ui/react-dialog";
import { X } from "@phosphor-icons/react";
import type { ReactNode } from "react";

export function Modal({
  title,
  description,
  children,
  onClose,
  className = "",
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal-content ${className}`}
          onOpenAutoFocus={(event) => {
            if (className.includes("page-editor")) event.preventDefault();
          }}
        >
          <header className="modal-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <button
              className="icon-button"
              onClick={onClose}
              aria-label="关闭对话框"
            >
              <X size={19} />
            </button>
          </header>
          <Dialog.Description className="modal-description">
            {description}
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
