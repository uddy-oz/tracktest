import { useEffect, useRef, type RefObject } from "react";
import { getTrappedFocusIndex } from "../lib/dialogAccessibility";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type AccessibleDialogOptions = {
  open: boolean;
  onClose?: () => void;
  closeOnEscape?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  focusDialog?: boolean;
};

type InertSnapshot = {
  element: HTMLElement;
  inert: boolean;
  ariaHidden: string | null;
};

function getFocusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hidden &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0
  );
}

function makeBackgroundInert(dialog: HTMLElement) {
  const snapshots: InertSnapshot[] = [];
  let activeBranch: HTMLElement | null = dialog;

  while (activeBranch?.parentElement) {
    const parent: HTMLElement = activeBranch.parentElement;

    for (const sibling of Array.from(parent.children)) {
      if (!(sibling instanceof HTMLElement) || sibling === activeBranch) continue;

      snapshots.push({
        element: sibling,
        inert: sibling.inert,
        ariaHidden: sibling.getAttribute("aria-hidden"),
      });
      sibling.inert = true;
      sibling.setAttribute("aria-hidden", "true");
    }

    activeBranch = parent;
    if (activeBranch === document.body) break;
  }

  return () => {
    for (const snapshot of snapshots.reverse()) {
      snapshot.element.inert = snapshot.inert;
      if (snapshot.ariaHidden === null) {
        snapshot.element.removeAttribute("aria-hidden");
      } else {
        snapshot.element.setAttribute("aria-hidden", snapshot.ariaHidden);
      }
    }
  };
}

export function useAccessibleDialog<T extends HTMLElement>({
  open,
  onClose,
  closeOnEscape = true,
  initialFocusRef,
  focusDialog = false,
}: AccessibleDialogOptions) {
  const dialogRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || !dialogRef.current) return;

    const dialog = dialogRef.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousTabIndex = dialog.getAttribute("tabindex");
    dialog.setAttribute("tabindex", "-1");
    const restoreBackground = makeBackgroundInert(dialog);

    function focusInitialTarget() {
      const preferred = initialFocusRef?.current;
      if (preferred && dialog.contains(preferred)) {
        preferred.focus();
        return;
      }

      if (focusDialog) {
        dialog.focus();
        return;
      }

      (getFocusableElements(dialog)[0] || dialog).focus();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (closeOnEscape && onCloseRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }

      if (event.key !== "Tab") return;

      const focusableElements = getFocusableElements(dialog);
      event.preventDefault();

      if (focusableElements.length === 0) {
        dialog.focus();
        return;
      }

      const activeIndex = focusableElements.indexOf(
        document.activeElement as HTMLElement
      );
      const nextIndex = getTrappedFocusIndex(
        activeIndex,
        focusableElements.length,
        event.shiftKey ? "backward" : "forward"
      );
      focusableElements[nextIndex]?.focus();
    }

    function handleFocusIn(event: FocusEvent) {
      if (!dialog.contains(event.target as Node)) focusInitialTarget();
    }

    const focusFrame = window.requestAnimationFrame(focusInitialTarget);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocusIn, true);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      restoreBackground();

      if (previousTabIndex === null) dialog.removeAttribute("tabindex");
      else dialog.setAttribute("tabindex", previousTabIndex);

      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [closeOnEscape, focusDialog, initialFocusRef, open]);

  return dialogRef;
}
