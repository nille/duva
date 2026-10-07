// The two panes of the mail on a desk: a list, and what is open from it beside it. A list keeps its
// place while a thread or a draft is read beside it, so it is then a region of the page, headed one
// level down, and the open view is the page's main content. Each list view lays itself out with
// these, so it needn't know where it lies.
import { createContext, type HTMLAttributes, type ReactNode, type Ref, useContext, useEffect, useId } from "react";

/** Whether the list lies beside something open, whether that is a thread, and the thread or draft open, whose line it marks. */
export interface Beside {
  beside: boolean;
  thread?: boolean;
  open?: string;
}

export const BesideContext = createContext<Beside>({ beside: false });

/** Whether the list lies beside something open, and what is open. */
export const useBeside = () => useContext(BesideContext);

const TitleContext = createContext<string | undefined>(undefined);

/**
 * A view's root: the page's main content, or, beside something open, a region named by its title.
 * It stays the same element either way, so what the list shows keeps its place.
 */
export function ViewMain({ children, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  const { beside } = useBeside();
  const titleId = useId();
  return (
    <div {...rest} role={beside ? "region" : "main"} aria-labelledby={beside ? titleId : undefined}>
      <TitleContext value={titleId}>{children}</TitleContext>
    </div>
  );
}

/** A view's title: the page's heading, or one level down beside something open. */
export function ViewTitle({ ref, ...rest }: HTMLAttributes<HTMLHeadingElement> & { ref?: Ref<HTMLHeadingElement> }) {
  const { beside } = useBeside();
  const id = useContext(TitleContext);
  return beside ? <h2 ref={ref} id={id} {...rest} /> : <h1 ref={ref} id={id} {...rest} />;
}

/** Names the tab for the view, as `title`, unless the view lies beside something open, which names it then. */
export function useViewTitle(title: string) {
  const { beside } = useBeside();
  useEffect(() => {
    if (!beside) document.title = title;
  }, [title, beside]);
}

/** Takes how many of the list's threads are unread, which the phone's switcher says as the list's head. */
export const ListCountContext = createContext<(count: number) => void>(() => undefined);

/** Says how many of the list's threads are unread to the phone's switcher, until the list closes. */
export function useListCount(count: number) {
  const say = useContext(ListCountContext);
  useEffect(() => {
    say(count);
    return () => say(0);
  }, [say, count]);
}
