import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  ColumnResizeMode,
  ColumnDef,
  ColumnSizingState,
  Header,
  Row,
  getPaginationRowModel,
  VisibilityState,
  SortingState,
  getSortedRowModel,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TABLE_SETTINGS_KEY } from "@/app/localStorageKeys";
import ReactMarkdown from "react-markdown";
import debounce from "lodash/debounce";
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export type DataType = Record<string, unknown>;
export type ColumnType<T extends DataType> = ColumnDef<T> & {
  initialWidth?: number;
  accessorKey?: string;
};

interface ColumnStats {
  min: number;
  max: number;
  avg: number;
  distribution: number[];
  bucketSize: number;
  type: "number" | "array" | "string";
}

function calculateColumnStats(
  data: Record<string, unknown>[],
  accessor: string
): ColumnStats | null {
  let type: "number" | "array" | "string" = "string";
  const firstValue = data.find((row) => row[accessor] != null)?.[accessor];

  // Determine type based on first non-null value
  if (typeof firstValue === "number") type = "number";
  if (Array.isArray(firstValue)) type = "array";

  const values = data
    .map((row) => {
      const value = row[accessor];

      if (value === null || value === undefined) {
        return null;
      }

      // For numbers, use the value directly
      if (typeof value === "number") {
        return value;
      }

      // For arrays, count number of elements
      if (Array.isArray(value)) {
        return value.length;
      }

      // For strings and other types, count words after converting to string
      const stringValue =
        typeof value === "string" ? value : JSON.stringify(value);
      return stringValue.split(/\s+/).length;
    })
    .filter((length): length is number => length !== null);

  if (values.length === 0) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((sum, val) => sum + val, 0) / values.length;

  // Special handling for single distinct value
  if (min === max) {
    return {
      min,
      max,
      avg,
      distribution: [values.length], // Put all values in a single bucket
      bucketSize: 1,
      type: type,
    };
  }

  // For numbers, use more precise bucketing
  const bucketSize =
    type === "number" ? (max - min) / 7 : Math.ceil((max - min) / 7);

  const distribution = new Array(7).fill(0);

  values.forEach((value) => {
    const bucketIndex = Math.min(
      Math.floor((value - min) / bucketSize),
      distribution.length - 1
    );
    distribution[bucketIndex]++;
  });

  return {
    min,
    max,
    avg,
    distribution,
    bucketSize,
    type,
  };
}

const WordCountHistogram = React.memo(
  ({
    histogramData,
  }: {
    histogramData: { range: string; count: number; fullRange: string }[];
  }) => {
    // Calculate total count for fractions
    const totalCount = useMemo(
      () => histogramData.reduce((sum, item) => sum + item.count, 0),
      [histogramData]
    );

    return (
      <ResponsiveContainer width="100%" height={40}>
        <BarChart data={histogramData} barCategoryGap={1}>
          <XAxis
            dataKey="range"
            tick={{ fontSize: 8 }}
            interval={2}
            tickLine={false}
            stroke="hsl(var(--muted-foreground))"
            height={15}
          />
          <Tooltip
            formatter={(value: number) => [
              `${value.toLocaleString()} (${(
                (value / totalCount) *
                100
              ).toFixed(1)}%)`,
              "Count",
            ]}
            labelFormatter={(label: string) => label}
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "var(--radius)",
              color: "hsl(var(--popover-foreground))",
              padding: "8px 12px",
              boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
            }}
            wrapperStyle={{ zIndex: 1000 }}
          />
          <Bar
            dataKey="count"
            fill="hsl(var(--chart-2))"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    );
  }
);
WordCountHistogram.displayName = "WordCountHistogram";

interface ColumnHeaderProps {
  header: string;
  stats: ColumnStats | null;
  isBold: boolean;
  onSort: () => void;
  sortDirection: "asc" | "desc" | false;
}

const ColumnHeader = React.memo(
  ({ header, stats, isBold, onSort, sortDirection }: ColumnHeaderProps) => {
    const histogramData = useMemo(() => {
      if (!stats) return [];

      const getUnitLabel = () => {
        switch (stats.type) {
          case "number":
            return "";
          case "array":
            return " items";
          default:
            return " words";
        }
      };

      // Special handling for single distinct value
      if (stats.min === stats.max) {
        return [
          {
            range: `${Math.round(stats.min)}`,
            count: stats.distribution[0],
            fullRange: `${Math.round(stats.min)}${getUnitLabel()}`,
          },
        ];
      }

      return stats.distribution.map((count, i) => ({
        range: `${Math.round(stats.min + i * stats.bucketSize)}`,
        count,
        fullRange: `${Math.round(
          stats.min + i * stats.bucketSize
        )} - ${Math.round(
          stats.min + (i + 1) * stats.bucketSize
        )}${getUnitLabel()}`,
      }));
    }, [stats]);

    return (
      <div className="space-y-1">
        <div className={`${isBold ? "font-bold" : ""} flex items-center gap-2`}>
          <span>{header}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSort();
            }}
            className="p-0.5 hover:bg-accent rounded-sm"
          >
            {sortDirection === false && <ArrowUpDown className="h-3 w-3" />}
            {sortDirection === "asc" && <ArrowUp className="h-3 w-3" />}
            {sortDirection === "desc" && <ArrowDown className="h-3 w-3" />}
          </button>
        </div>
        {stats && (
          <div className="space-y-0.5">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              {stats.min === stats.max ? (
                <span className="w-full text-center">
                  Single value: {stats.min}
                  {stats.type === "array"
                    ? " items"
                    : stats.type === "string"
                    ? " words"
                    : ""}
                </span>
              ) : (
                <>
                  <span>
                    {stats.min}
                    {stats.type === "array"
                      ? " items"
                      : stats.type === "string"
                      ? " words"
                      : ""}
                  </span>
                  <span>avg: {Math.round(stats.avg)}</span>
                  <span>
                    {stats.max}
                    {stats.type === "array"
                      ? " items"
                      : stats.type === "string"
                      ? " words"
                      : ""}
                  </span>
                </>
              )}
            </div>
            <div className="h-10 w-full">
              <WordCountHistogram histogramData={histogramData} />
            </div>
          </div>
        )}
      </div>
    );
  }
);
ColumnHeader.displayName = "ColumnHeader";

const ColumnResizer = <T extends DataType>({
  header,
}: {
  header: Header<T, unknown>;
}) => {
  return (
    <div
      onMouseDown={header.getResizeHandler()}
      onTouchStart={header.getResizeHandler()}
      className={`absolute right-0 top-0 h-full w-2 cursor-col-resize bg-slate-400 opacity-0 hover:opacity-100`}
      style={{
        userSelect: "none",
        touchAction: "none",
      }}
    />
  );
};

interface ResizableRow<T extends DataType> extends Row<T> {
  getSize: () => number;
  setSize: (size: number) => void;
}

const RowResizer = <T extends DataType>({ row }: { row: ResizableRow<T> }) => {
  return (
    <tr>
      <td colSpan={100}>
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            const startY = e.clientY;
            const startHeight = row.getSize();

            const onMouseMove = (e: MouseEvent) => {
              const newHeight = Math.max(startHeight + e.clientY - startY, 30);
              row.setSize(newHeight);
            };

            const onMouseUp = () => {
              document.removeEventListener("mousemove", onMouseMove);
              document.removeEventListener("mouseup", onMouseUp);
            };

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
          }}
          className={`h-2 cursor-row-resize bg-slate-400 opacity-0 hover:opacity-100`}
          style={{
            userSelect: "none",
            touchAction: "none",
          }}
        />
      </td>
    </tr>
  );
};

interface ResizableDataTableProps<T extends DataType> {
  data: T[];
  columns: ColumnType<T>[];
  boldedColumns: string[];
  startingRowHeight?: number;
}

interface MarkdownCellProps {
  content: string;
}

const MarkdownCell = React.memo(({ content }: MarkdownCellProps) => {
  return (
    <ReactMarkdown
      components={{
        h1: ({ children }) => (
          <div style={{ fontWeight: "bold", fontSize: "1.5rem" }}>
            {children}
          </div>
        ),
        h2: ({ children }) => (
          <div style={{ fontWeight: "bold", fontSize: "1.25rem" }}>
            {children}
          </div>
        ),
        h3: ({ children }) => (
          <div style={{ fontWeight: "bold", fontSize: "1.1rem" }}>
            {children}
          </div>
        ),
        h4: ({ children }) => (
          <div style={{ fontWeight: "bold" }}>{children}</div>
        ),
        ul: ({ children }) => (
          <ul
            style={{
              listStyleType: "•",
              paddingLeft: "1rem",
              margin: "0.25rem 0",
            }}
          >
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol
            style={{
              listStyleType: "decimal",
              paddingLeft: "1rem",
              margin: "0.25rem 0",
            }}
          >
            {children}
          </ol>
        ),
        li: ({ children }) => (
          <li style={{ marginBottom: "0.125rem" }}>{children}</li>
        ),
        code: ({
          className,
          children,
          inline,
          ...props
        }: {
          className?: string;
          children: React.ReactNode;
          inline?: boolean;
        }) => {
          const match = /language-(\w+)/.exec(className || "");
          return !inline && match ? (
            <pre className="bg-slate-100 p-2 rounded">
              <code className={className} {...props}>
                {children}
              </code>
            </pre>
          ) : (
            <code className="bg-slate-100 px-1 rounded" {...props}>
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className="bg-slate-100 p-2 rounded">{children}</pre>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-slate-300 pl-4 my-2 italic">
            {children}
          </blockquote>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
});
MarkdownCell.displayName = "MarkdownCell";

interface SearchableCellProps {
  content: string;
  isResizing: boolean;
}

const SearchableCell = React.memo(
  ({ content, isResizing }: SearchableCellProps) => {
    const [searchTerm, setSearchTerm] = useState("");
    const [highlightedContent, setHighlightedContent] = useState(content);
    const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
    const [matchCount, setMatchCount] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);

    // Search functionality
    useEffect(() => {
      if (!searchTerm) {
        setHighlightedContent(content);
        setMatchCount(0);
        setCurrentMatchIndex(0);
        return;
      }

      try {
        const regex = new RegExp(`(${searchTerm})`, "gi");
        const matches = content.match(regex);
        const matchesCount = matches ? matches.length : 0;
        setMatchCount(matchesCount);

        if (matchesCount > 0) {
          const highlighted = content.replace(
            regex,
            (match) => `<mark class="search-match">${match}</mark>`
          );
          setHighlightedContent(highlighted);

          // Scroll to current match
          setTimeout(() => {
            if (containerRef.current) {
              const marks =
                containerRef.current.getElementsByClassName("search-match");
              if (marks.length > 0 && currentMatchIndex < marks.length) {
                marks[currentMatchIndex].scrollIntoView({
                  behavior: "smooth",
                  block: "center",
                });
              }
            }
          }, 100);
        } else {
          setHighlightedContent(content);
        }
      } catch {
        setHighlightedContent(content);
        setMatchCount(0);
      }
    }, [searchTerm, content, currentMatchIndex]);

    const navigateMatches = useCallback(
      (direction: "next" | "prev") => {
        if (matchCount === 0) return;

        if (direction === "next") {
          setCurrentMatchIndex((prev) => (prev + 1) % matchCount);
        } else {
          setCurrentMatchIndex((prev) => (prev - 1 + matchCount) % matchCount);
        }
      },
      [matchCount]
    );

    // Style for search matches
    useEffect(() => {
      const styleId = "search-match-style";
      let styleElement = document.getElementById(styleId) as HTMLStyleElement;

      if (!styleElement) {
        styleElement = document.createElement("style");
        styleElement.id = styleId;
        document.head.appendChild(styleElement);
      }

      styleElement.textContent = `
        mark.search-match {
          background-color: hsl(var(--primary) / 0.2);
          color: inherit;
          padding: 0;
          border-radius: 2px;
        }
        mark.search-match:nth-of-type(${currentMatchIndex + 1}) {
          background-color: hsl(var(--primary) / 0.5);
        }
      `;

      return () => {
        if (styleElement && styleElement.parentNode) {
          styleElement.parentNode.removeChild(styleElement);
        }
      };
    }, [currentMatchIndex]);

    return (
      <div className="relative">
        <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm rounded-md">
          <div className="flex items-center gap-2 p-1">
            <Search className="h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Search in cell..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentMatchIndex(0);
              }}
              className="h-6 text-xs border-none shadow-none focus-visible:ring-0"
            />
            {matchCount > 0 && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  onClick={() => navigateMatches("prev")}
                >
                  <ChevronLeft className="h-3 w-3" />
                </Button>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {currentMatchIndex + 1}/{matchCount}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  onClick={() => navigateMatches("next")}
                >
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        </div>
        <div ref={containerRef}>
          {isResizing ? (
            <div>{content}</div>
          ) : searchTerm ? (
            <div
              dangerouslySetInnerHTML={{ __html: highlightedContent }}
              className="prose prose-sm max-w-none"
            />
          ) : (
            <MarkdownCell content={content} />
          )}
        </div>
      </div>
    );
  }
);
SearchableCell.displayName = "SearchableCell";

function ResizableDataTable<T extends DataType>({
  data,
  columns,
  boldedColumns,
  startingRowHeight = 60, // Default starting height
}: ResizableDataTableProps<T>) {
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => {
    const savedSettings = localStorage.getItem(TABLE_SETTINGS_KEY);
    if (savedSettings) {
      const parsedSettings = JSON.parse(savedSettings);
      return parsedSettings.columnSizing || {};
    }
    const initialSizing: ColumnSizingState = {};
    columns.forEach((column) => {
      if (column.initialWidth) {
        initialSizing[column.id as string] = column.initialWidth;
      }
    });
    return initialSizing;
  });
  const [rowSizing, setRowSizing] = useState<Record<string, number>>(() => {
    const savedSettings = localStorage.getItem(TABLE_SETTINGS_KEY);
    if (savedSettings) {
      const parsedSettings = JSON.parse(savedSettings);
      return parsedSettings.rowSizing || {};
    }
    return {};
  });
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [sorting, setSorting] = useState<SortingState>([]);

  const saveSettings = useCallback(() => {
    localStorage.setItem(
      TABLE_SETTINGS_KEY,
      JSON.stringify({ columnSizing, rowSizing })
    );
  }, [columnSizing, rowSizing]);

  useEffect(() => {
    // Initialize row heights when data changes
    const initialRowSizing = data.reduce((acc, _, index) => {
      acc[index] = startingRowHeight;
      return acc;
    }, {} as Record<string, number>);
    setRowSizing(initialRowSizing);

    // Initialize all columns as visible
    const initialColumnVisibility = columns.reduce((acc, column) => {
      acc[column.id as string] = true;
      return acc;
    }, {} as VisibilityState);
    setColumnVisibility(initialColumnVisibility);
  }, [data, startingRowHeight, columns]);

  // Add this before creating the table instance
  const sortedColumns = [...columns].sort((a, b) => {
    const aHeader = a.header as string;
    const bHeader = b.header as string;
    const aIsBold = boldedColumns.includes(aHeader);
    const bIsBold = boldedColumns.includes(bHeader);

    if (aIsBold && !bIsBold) return -1;
    if (!aIsBold && bIsBold) return 1;
    return 0;
  });

  const [isResizing, setIsResizing] = useState(false);
  const debouncedSetIsResizing = useMemo(
    () => debounce((value: boolean) => setIsResizing(value), 150),
    []
  );

  const columnStats = useMemo(() => {
    const stats: Record<string, ColumnStats | null> = {};
    columns.forEach((column) => {
      const accessorKey = (column as { accessorKey?: string }).accessorKey;
      if (accessorKey) {
        stats[accessorKey] = calculateColumnStats(data, accessorKey);
      }
    });
    return stats;
  }, [data, columns]);

  const table = useReactTable({
    data,
    columns: sortedColumns.map((col) => ({
      ...col,
      enableSorting: true,
      sortingFn: (rowA: Row<T>, rowB: Row<T>) => {
        const accessor = col.accessorKey;
        if (!accessor) return 0;

        const a = rowA.getValue(accessor);
        const b = rowB.getValue(accessor);

        // Handle null/undefined values
        if (a == null) return -1;
        if (b == null) return 1;

        // Sort based on type
        if (typeof a === "number" && typeof b === "number") {
          return a - b;
        }

        if (Array.isArray(a) && Array.isArray(b)) {
          return a.length - b.length;
        }

        // For strings, do alphabetical comparison
        return String(a).localeCompare(String(b));
      },
    })),
    columnResizeMode: "onChange" as ColumnResizeMode,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onColumnSizingChange: (newColumnSizing) => {
      setColumnSizing(newColumnSizing);
      setIsResizing(true);
      debouncedSetIsResizing(false);
      saveSettings();
    },
    onColumnVisibilityChange: setColumnVisibility,
    onSortingChange: setSorting,
    state: {
      columnSizing,
      columnVisibility,
      sorting,
    },
    enableSorting: true,
    enableColumnResizing: true,
    defaultColumn: {
      minSize: 30,
      size: 150,
      maxSize: Number.MAX_SAFE_INTEGER,
    },
    initialState: {
      pagination: {
        pageSize: 5,
      },
    },
  });

  return (
    <div className="w-full overflow-auto">
      <div className="mb-2 flex justify-between items-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="flex items-center ml-2 h-7"
            >
              Show/Hide Columns
              <ChevronDown className="ml-1 h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            {table.getAllLeafColumns().map((column) => {
              return (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) => column.toggleVisibility(!!value)}
                >
                  {column.id}
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex items-center space-x-2">
          {data.length > 0 && (
            <div className="flex items-center justify-end space-x-2 py-1 mr-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <ChevronLeft className="mr-1 h-3 w-3" /> Previous
              </Button>
              <span className="text-xs text-gray-600">
                Page {table.getState().pagination.pageIndex + 1} of{" "}
                {table.getPageCount()}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                Next <ChevronRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      </div>
      <Table style={{ width: "max-content", minWidth: "100%" }}>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              <TableHead style={{ width: "30px" }}>#</TableHead>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  style={{
                    width: header.getSize(),
                    position: "relative",
                    minWidth: `${header.column.columnDef.minSize}px`,
                    maxWidth: `${header.column.columnDef.maxSize}px`,
                    fontWeight: boldedColumns.includes(
                      header.column.columnDef.header as string
                    )
                      ? "bold"
                      : "normal",
                  }}
                >
                  {header.isPlaceholder ? null : (
                    <ColumnHeader
                      header={header.column.columnDef.header as string}
                      stats={
                        columnStats[
                          (header.column.columnDef as { accessorKey?: string })
                            .accessorKey || ""
                        ]
                      }
                      isBold={boldedColumns.includes(
                        header.column.columnDef.header as string
                      )}
                      onSort={() => header.column.toggleSorting()}
                      sortDirection={
                        header.column.getIsSorted() as false | "asc" | "desc"
                      }
                    />
                  )}
                  <ColumnResizer header={header} />
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row, index) => (
            <React.Fragment key={row.id}>
              <TableRow>
                <TableCell
                  style={{
                    width: "30px",
                    padding: "0.25rem",
                    textAlign: "center",
                  }}
                >
                  <span style={{ fontSize: "0.75rem", color: "#888" }}>
                    {row.index + 1}
                  </span>
                </TableCell>
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    style={{
                      width: cell.column.getSize(),
                      minWidth: cell.column.columnDef.minSize,
                      height: `${rowSizing[index] || startingRowHeight}px`,
                      padding: "0",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        overflowY: "auto",
                        padding: "0.5rem",
                        fontWeight: "normal",
                      }}
                    >
                      {typeof cell.getValue() === "string" ? (
                        <SearchableCell
                          content={cell.getValue() as string}
                          isResizing={isResizing}
                        />
                      ) : (
                        flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )
                      )}
                    </div>
                  </TableCell>
                ))}
              </TableRow>
              <RowResizer
                row={{
                  ...row,
                  getSize: () => rowSizing[index] || startingRowHeight,
                  setSize: (size: number) => {
                    setRowSizing((prev) => {
                      const newRowSizing = { ...prev, [index]: size };
                      saveSettings();
                      return newRowSizing;
                    });
                  },
                }}
              />
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
      {data.length > 0 && (
        <div className="flex items-center justify-end space-x-2 py-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="mr-2 h-4 w-4" /> Previous
          </Button>
          <span className="text-sm text-gray-600">
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount()}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default ResizableDataTable;
