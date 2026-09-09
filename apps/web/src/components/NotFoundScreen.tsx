import { SearchBox } from './SearchBox.js';

export function NotFoundScreen({ message }: { message: string }) {
  return (
    <div className="flex w-full flex-col items-center gap-4 text-center">
      <h1 className="text-xl font-semibold text-slate-700">{message}</h1>
      <p className="text-sm text-slate-500">Search for another entry:</p>
      <SearchBox />
    </div>
  );
}
