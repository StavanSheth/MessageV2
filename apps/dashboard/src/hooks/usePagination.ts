import { useState, useMemo, useEffect } from 'react';

export interface UsePaginationOptions {
  initialPageSize?: number;
  initialPage?: number;
}

export function usePagination<T>(items: T[], options: UsePaginationOptions = {}) {
  const [pageSize, setPageSize] = useState<number>(options.initialPageSize ?? 25);
  const [currentPage, setCurrentPage] = useState<number>(options.initialPage ?? 1);

  const totalFiltered = items.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, currentPage, pageSize]);

  const goToNextPage = () => setCurrentPage((p) => Math.min(totalPages, p + 1));
  const goToPrevPage = () => setCurrentPage((p) => Math.max(1, p - 1));

  return {
    pageSize,
    setPageSize,
    currentPage,
    setCurrentPage,
    totalPages,
    totalFiltered,
    paginatedItems,
    goToNextPage,
    goToPrevPage,
  };
}
