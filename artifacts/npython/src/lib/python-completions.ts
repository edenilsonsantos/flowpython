import { CompletionContext, CompletionResult, Completion } from "@codemirror/autocomplete";

// ── Static method/attribute maps for common Python libraries ─────────────────

const PANDAS_COMPLETIONS: Completion[] = [
  // DataFrame constructors / IO
  { label: "DataFrame()", type: "function", info: "Create a DataFrame" },
  { label: "read_csv()", type: "function", info: "Read CSV file into DataFrame" },
  { label: "read_excel()", type: "function", info: "Read Excel file into DataFrame" },
  { label: "read_json()", type: "function", info: "Read JSON into DataFrame" },
  { label: "read_sql()", type: "function", info: "Read SQL query into DataFrame" },
  { label: "read_parquet()", type: "function", info: "Read Parquet file" },
  { label: "Series()", type: "function", info: "Create a Series" },
  { label: "concat()", type: "function", info: "Concatenate objects along axis" },
  { label: "merge()", type: "function", info: "Merge DataFrame objects" },
  { label: "to_datetime()", type: "function", info: "Convert to datetime" },
  { label: "to_numeric()", type: "function", info: "Convert to numeric type" },
  { label: "isna()", type: "function", info: "Detect missing values" },
  { label: "notna()", type: "function", info: "Detect non-missing values" },
  { label: "get_dummies()", type: "function", info: "Convert categorical variable into indicator variables" },
  { label: "date_range()", type: "function", info: "Return fixed frequency DatetimeIndex" },
  { label: "pivot_table()", type: "function", info: "Create a spreadsheet-style pivot table" },
  { label: "melt()", type: "function", info: "Unpivot a DataFrame from wide to long format" },
  { label: "json_normalize()", type: "function", info: "Normalize semi-structured JSON data" },
  { label: "cut()", type: "function", info: "Bin values into discrete intervals" },
  { label: "qcut()", type: "function", info: "Quantile-based discrete binning" },
  { label: "Timestamp()", type: "class", info: "Pandas Timestamp object" },
  { label: "NA", type: "constant", info: "Pandas NA value" },
  { label: "NaT", type: "constant", info: "Not a Time value" },
];

const DATAFRAME_COMPLETIONS: Completion[] = [
  { label: "head()", type: "method", info: "Return the first n rows" },
  { label: "tail()", type: "method", info: "Return the last n rows" },
  { label: "describe()", type: "method", info: "Generate descriptive statistics" },
  { label: "info()", type: "method", info: "Print DataFrame info" },
  { label: "shape", type: "property", info: "Return shape (rows, cols)" },
  { label: "columns", type: "property", info: "Column labels" },
  { label: "index", type: "property", info: "Row index" },
  { label: "dtypes", type: "property", info: "Return dtypes of each column" },
  { label: "values", type: "property", info: "Numpy array of values" },
  { label: "loc[]", type: "method", info: "Label-based indexing" },
  { label: "iloc[]", type: "method", info: "Integer-based indexing" },
  { label: "groupby()", type: "method", info: "Group by columns" },
  { label: "sort_values()", type: "method", info: "Sort by column values" },
  { label: "sort_index()", type: "method", info: "Sort by index" },
  { label: "drop()", type: "method", info: "Drop rows/columns" },
  { label: "dropna()", type: "method", info: "Remove missing values" },
  { label: "fillna()", type: "method", info: "Fill missing values" },
  { label: "rename()", type: "method", info: "Rename columns/index" },
  { label: "reset_index()", type: "method", info: "Reset the index" },
  { label: "set_index()", type: "method", info: "Set column as index" },
  { label: "merge()", type: "method", info: "Merge with another DataFrame" },
  { label: "join()", type: "method", info: "Join with another DataFrame" },
  { label: "pivot()", type: "method", info: "Pivot table" },
  { label: "melt()", type: "method", info: "Unpivot" },
  { label: "apply()", type: "method", info: "Apply function along axis" },
  { label: "map()", type: "method", info: "Map values via dict or function" },
  { label: "applymap()", type: "method", info: "Apply function element-wise" },
  { label: "filter()", type: "method", info: "Subset columns/rows" },
  { label: "query()", type: "method", info: "Query using a string expression" },
  { label: "assign()", type: "method", info: "Add new columns" },
  { label: "copy()", type: "method", info: "Return a copy of this object" },
  { label: "to_dict()", type: "method", info: "Convert to dictionary" },
  { label: "to_json()", type: "method", info: "Convert to JSON string" },
  { label: "to_csv()", type: "method", info: "Write to CSV file" },
  { label: "to_excel()", type: "method", info: "Write to Excel file" },
  { label: "to_parquet()", type: "method", info: "Write to Parquet file" },
  { label: "to_sql()", type: "method", info: "Write to SQL database" },
  { label: "to_list()", type: "method", info: "Convert to list" },
  { label: "to_numpy()", type: "method", info: "Convert to numpy array" },
  { label: "isnull()", type: "method", info: "Detect missing values" },
  { label: "notnull()", type: "method", info: "Detect non-missing values" },
  { label: "nunique()", type: "method", info: "Count distinct elements" },
  { label: "value_counts()", type: "method", info: "Count unique values" },
  { label: "corr()", type: "method", info: "Compute pairwise correlation" },
  { label: "cov()", type: "method", info: "Compute pairwise covariance" },
  { label: "mean()", type: "method", info: "Return mean of values" },
  { label: "median()", type: "method", info: "Return median of values" },
  { label: "std()", type: "method", info: "Return standard deviation" },
  { label: "var()", type: "method", info: "Return variance" },
  { label: "sum()", type: "method", info: "Return sum of values" },
  { label: "min()", type: "method", info: "Return minimum of values" },
  { label: "max()", type: "method", info: "Return maximum of values" },
  { label: "count()", type: "method", info: "Count non-null values" },
  { label: "cumsum()", type: "method", info: "Cumulative sum" },
  { label: "cumprod()", type: "method", info: "Cumulative product" },
  { label: "rolling()", type: "method", info: "Rolling window calculation" },
  { label: "resample()", type: "method", info: "Resample time-series data" },
  { label: "shift()", type: "method", info: "Shift index by n periods" },
  { label: "diff()", type: "method", info: "First discrete difference" },
  { label: "pct_change()", type: "method", info: "Percentage change" },
  { label: "sample()", type: "method", info: "Return random sample" },
  { label: "nlargest()", type: "method", info: "Return n largest values" },
  { label: "nsmallest()", type: "method", info: "Return n smallest values" },
  { label: "explode()", type: "method", info: "Transform list-like to rows" },
  { label: "stack()", type: "method", info: "Stack column level to row" },
  { label: "unstack()", type: "method", info: "Unstack row level to column" },
  { label: "transpose()", type: "method", info: "Transpose index and columns" },
  { label: "T", type: "property", info: "Transpose" },
  { label: "empty", type: "property", info: "True if DataFrame is empty" },
  { label: "size", type: "property", info: "Total number of elements" },
  { label: "ndim", type: "property", info: "Number of dimensions" },
  { label: "axes", type: "property", info: "List of axes" },
  { label: "memory_usage()", type: "method", info: "Return memory usage per column" },
  { label: "iterrows()", type: "method", info: "Iterate over rows as (index, Series)" },
  { label: "itertuples()", type: "method", info: "Iterate over rows as namedtuples" },
  { label: "items()", type: "method", info: "Iterate over (column, Series) pairs" },
  { label: "pipe()", type: "method", info: "Apply function chainable" },
  { label: "clip()", type: "method", info: "Trim values at thresholds" },
  { label: "abs()", type: "method", info: "Return absolute values" },
  { label: "round()", type: "method", info: "Round to given decimal places" },
  { label: "duplicated()", type: "method", info: "Return boolean Series of duplicates" },
  { label: "drop_duplicates()", type: "method", info: "Remove duplicate rows" },
  { label: "between()", type: "method", info: "Return boolean Series between values" },
  { label: "isin()", type: "method", info: "Check membership in values" },
  { label: "where()", type: "method", info: "Replace values where condition is False" },
  { label: "mask()", type: "method", info: "Replace values where condition is True" },
  { label: "eval()", type: "method", info: "Evaluate a string expression" },
  { label: "swaplevel()", type: "method", info: "Swap levels in MultiIndex" },
  { label: "xs()", type: "method", info: "Cross-section from MultiIndex" },
];

const NUMPY_COMPLETIONS: Completion[] = [
  { label: "array()", type: "function", info: "Create ndarray" },
  { label: "zeros()", type: "function", info: "Array of zeros" },
  { label: "ones()", type: "function", info: "Array of ones" },
  { label: "empty()", type: "function", info: "Empty array (uninitialized)" },
  { label: "arange()", type: "function", info: "Evenly spaced values" },
  { label: "linspace()", type: "function", info: "Evenly spaced over interval" },
  { label: "eye()", type: "function", info: "Identity matrix" },
  { label: "random.rand()", type: "function", info: "Random values [0,1)" },
  { label: "random.randn()", type: "function", info: "Standard normal random values" },
  { label: "random.randint()", type: "function", info: "Random integers" },
  { label: "random.seed()", type: "function", info: "Seed random number generator" },
  { label: "random.choice()", type: "function", info: "Random choice from array" },
  { label: "random.shuffle()", type: "function", info: "Shuffle array in-place" },
  { label: "reshape()", type: "function", info: "Reshape array" },
  { label: "concatenate()", type: "function", info: "Concatenate arrays" },
  { label: "stack()", type: "function", info: "Stack arrays along new axis" },
  { label: "vstack()", type: "function", info: "Stack arrays vertically" },
  { label: "hstack()", type: "function", info: "Stack arrays horizontally" },
  { label: "split()", type: "function", info: "Split array into sub-arrays" },
  { label: "where()", type: "function", info: "Return elements based on condition" },
  { label: "argmax()", type: "function", info: "Index of max value" },
  { label: "argmin()", type: "function", info: "Index of min value" },
  { label: "argsort()", type: "function", info: "Indices that sort array" },
  { label: "sort()", type: "function", info: "Sort array" },
  { label: "unique()", type: "function", info: "Find unique elements" },
  { label: "sum()", type: "function", info: "Sum of array elements" },
  { label: "mean()", type: "function", info: "Mean of array elements" },
  { label: "median()", type: "function", info: "Median value" },
  { label: "std()", type: "function", info: "Standard deviation" },
  { label: "var()", type: "function", info: "Variance" },
  { label: "min()", type: "function", info: "Minimum value" },
  { label: "max()", type: "function", info: "Maximum value" },
  { label: "abs()", type: "function", info: "Absolute values" },
  { label: "sqrt()", type: "function", info: "Square root" },
  { label: "exp()", type: "function", info: "Exponential" },
  { label: "log()", type: "function", info: "Natural logarithm" },
  { label: "log2()", type: "function", info: "Base-2 logarithm" },
  { label: "log10()", type: "function", info: "Base-10 logarithm" },
  { label: "sin()", type: "function", info: "Sine" },
  { label: "cos()", type: "function", info: "Cosine" },
  { label: "tan()", type: "function", info: "Tangent" },
  { label: "pi", type: "constant", info: "Pi constant (3.14159...)" },
  { label: "inf", type: "constant", info: "Positive infinity" },
  { label: "nan", type: "constant", info: "Not a Number" },
  { label: "dot()", type: "function", info: "Dot product" },
  { label: "matmul()", type: "function", info: "Matrix multiplication" },
  { label: "transpose()", type: "function", info: "Permute array dimensions" },
  { label: "linalg.inv()", type: "function", info: "Matrix inverse" },
  { label: "linalg.det()", type: "function", info: "Matrix determinant" },
  { label: "linalg.eig()", type: "function", info: "Eigenvalues and eigenvectors" },
  { label: "clip()", type: "function", info: "Clip values to range" },
  { label: "round()", type: "function", info: "Round to given decimals" },
  { label: "floor()", type: "function", info: "Floor element-wise" },
  { label: "ceil()", type: "function", info: "Ceiling element-wise" },
  { label: "cumsum()", type: "function", info: "Cumulative sum" },
  { label: "cumprod()", type: "function", info: "Cumulative product" },
  { label: "ndarray.shape", type: "property", info: "Shape of array" },
  { label: "ndarray.dtype", type: "property", info: "Data type" },
  { label: "ndarray.size", type: "property", info: "Total number of elements" },
  { label: "ndarray.ndim", type: "property", info: "Number of dimensions" },
  { label: "ndarray.T", type: "property", info: "Transposed array" },
  { label: "ndarray.flatten()", type: "method", info: "Flatten to 1D" },
  { label: "ndarray.tolist()", type: "method", info: "Convert to Python list" },
  { label: "asarray()", type: "function", info: "Convert to array" },
  { label: "isnan()", type: "function", info: "Test if NaN" },
  { label: "isinf()", type: "function", info: "Test if infinite" },
  { label: "isfinite()", type: "function", info: "Test if finite" },
  { label: "equal()", type: "function", info: "Element-wise equality" },
  { label: "greater()", type: "function", info: "Element-wise greater" },
  { label: "less()", type: "function", info: "Element-wise less" },
  { label: "logical_and()", type: "function", info: "Logical AND element-wise" },
  { label: "logical_or()", type: "function", info: "Logical OR element-wise" },
  { label: "count_nonzero()", type: "function", info: "Count non-zero elements" },
  { label: "digitize()", type: "function", info: "Return indices for binned values" },
  { label: "histogram()", type: "function", info: "Compute histogram" },
  { label: "percentile()", type: "function", info: "Compute percentile" },
  { label: "cross()", type: "function", info: "Cross product" },
  { label: "outer()", type: "function", info: "Outer product" },
];

const REQUESTS_COMPLETIONS: Completion[] = [
  { label: "get()", type: "function", info: "HTTP GET request" },
  { label: "post()", type: "function", info: "HTTP POST request" },
  { label: "put()", type: "function", info: "HTTP PUT request" },
  { label: "patch()", type: "function", info: "HTTP PATCH request" },
  { label: "delete()", type: "function", info: "HTTP DELETE request" },
  { label: "head()", type: "function", info: "HTTP HEAD request" },
  { label: "options()", type: "function", info: "HTTP OPTIONS request" },
  { label: "Session()", type: "class", info: "Create a Session for persistent settings" },
  { label: "request()", type: "function", info: "Generic HTTP request" },
];

const OS_COMPLETIONS: Completion[] = [
  { label: "path.join()", type: "function", info: "Join path components" },
  { label: "path.exists()", type: "function", info: "Test if path exists" },
  { label: "path.isfile()", type: "function", info: "Test if path is file" },
  { label: "path.isdir()", type: "function", info: "Test if path is directory" },
  { label: "path.basename()", type: "function", info: "Base name of path" },
  { label: "path.dirname()", type: "function", info: "Directory of path" },
  { label: "path.splitext()", type: "function", info: "Split extension" },
  { label: "path.abspath()", type: "function", info: "Absolute path" },
  { label: "path.expanduser()", type: "function", info: "Expand ~ in path" },
  { label: "getcwd()", type: "function", info: "Get current working directory" },
  { label: "listdir()", type: "function", info: "List directory contents" },
  { label: "makedirs()", type: "function", info: "Create directories" },
  { label: "remove()", type: "function", info: "Remove a file" },
  { label: "rename()", type: "function", info: "Rename file or directory" },
  { label: "environ", type: "property", info: "Environment variables mapping" },
  { label: "getenv()", type: "function", info: "Get environment variable" },
  { label: "walk()", type: "function", info: "Walk directory tree" },
  { label: "stat()", type: "function", info: "Get file status" },
  { label: "sep", type: "constant", info: "Path separator" },
  { label: "linesep", type: "constant", info: "Line separator" },
];

const JSON_COMPLETIONS: Completion[] = [
  { label: "dumps()", type: "function", info: "Serialize to JSON string" },
  { label: "loads()", type: "function", info: "Deserialize from JSON string" },
  { label: "dump()", type: "function", info: "Serialize to file" },
  { label: "load()", type: "function", info: "Deserialize from file" },
  { label: "JSONDecodeError", type: "class", info: "JSON decode exception" },
];

const DATETIME_COMPLETIONS: Completion[] = [
  { label: "datetime()", type: "class", info: "Datetime object" },
  { label: "date()", type: "class", info: "Date object" },
  { label: "time()", type: "class", info: "Time object" },
  { label: "timedelta()", type: "class", info: "Duration object" },
  { label: "datetime.now()", type: "function", info: "Current local datetime" },
  { label: "datetime.utcnow()", type: "function", info: "Current UTC datetime" },
  { label: "datetime.today()", type: "function", info: "Today datetime" },
  { label: "datetime.strptime()", type: "function", info: "Parse string to datetime" },
  { label: "datetime.fromisoformat()", type: "function", info: "From ISO format string" },
  { label: "date.today()", type: "function", info: "Today's date" },
];

const RE_COMPLETIONS: Completion[] = [
  { label: "match()", type: "function", info: "Match pattern at string start" },
  { label: "search()", type: "function", info: "Search for pattern in string" },
  { label: "findall()", type: "function", info: "Find all non-overlapping matches" },
  { label: "finditer()", type: "function", info: "Iterator of match objects" },
  { label: "sub()", type: "function", info: "Replace matches with string" },
  { label: "split()", type: "function", info: "Split string by pattern" },
  { label: "compile()", type: "function", info: "Compile pattern into regex" },
  { label: "IGNORECASE", type: "constant", info: "Case-insensitive flag" },
  { label: "MULTILINE", type: "constant", info: "Multiline flag" },
  { label: "DOTALL", type: "constant", info: "Dot matches all characters flag" },
];

const MATH_COMPLETIONS: Completion[] = [
  { label: "sqrt()", type: "function", info: "Square root" },
  { label: "floor()", type: "function", info: "Floor of x" },
  { label: "ceil()", type: "function", info: "Ceiling of x" },
  { label: "round()", type: "function", info: "Round to n decimals" },
  { label: "abs()", type: "function", info: "Absolute value" },
  { label: "log()", type: "function", info: "Natural log" },
  { label: "log2()", type: "function", info: "Base-2 log" },
  { label: "log10()", type: "function", info: "Base-10 log" },
  { label: "exp()", type: "function", info: "e raised to power x" },
  { label: "pow()", type: "function", info: "x to the power y" },
  { label: "sin()", type: "function", info: "Sine" },
  { label: "cos()", type: "function", info: "Cosine" },
  { label: "tan()", type: "function", info: "Tangent" },
  { label: "pi", type: "constant", info: "Pi (3.14159...)" },
  { label: "e", type: "constant", info: "Euler's number" },
  { label: "inf", type: "constant", info: "Positive infinity" },
  { label: "factorial()", type: "function", info: "Factorial" },
  { label: "gcd()", type: "function", info: "Greatest common divisor" },
  { label: "isnan()", type: "function", info: "True if NaN" },
  { label: "isinf()", type: "function", info: "True if infinite" },
  { label: "isfinite()", type: "function", info: "True if finite" },
];

const PATHLIB_COMPLETIONS: Completion[] = [
  { label: "Path()", type: "class", info: "Path object" },
  { label: "Path.home()", type: "function", info: "Home directory" },
  { label: "Path.cwd()", type: "function", info: "Current working directory" },
  { label: "exists()", type: "method", info: "Test if path exists" },
  { label: "is_file()", type: "method", info: "Test if file" },
  { label: "is_dir()", type: "method", info: "Test if directory" },
  { label: "read_text()", type: "method", info: "Read file as text" },
  { label: "write_text()", type: "method", info: "Write text to file" },
  { label: "read_bytes()", type: "method", info: "Read file as bytes" },
  { label: "write_bytes()", type: "method", info: "Write bytes to file" },
  { label: "mkdir()", type: "method", info: "Create directory" },
  { label: "unlink()", type: "method", info: "Remove file" },
  { label: "rename()", type: "method", info: "Rename path" },
  { label: "glob()", type: "method", info: "Glob matching pattern" },
  { label: "iterdir()", type: "method", info: "Iterate directory contents" },
  { label: "parent", type: "property", info: "Parent directory" },
  { label: "name", type: "property", info: "Final component of path" },
  { label: "stem", type: "property", info: "Name without suffix" },
  { label: "suffix", type: "property", info: "File extension" },
  { label: "parts", type: "property", info: "Tuple of path components" },
];

const COLLECTIONS_COMPLETIONS: Completion[] = [
  { label: "Counter()", type: "class", info: "Dict subclass for counting" },
  { label: "defaultdict()", type: "class", info: "Dict with default values" },
  { label: "OrderedDict()", type: "class", info: "Dict that preserves insertion order" },
  { label: "namedtuple()", type: "function", info: "Create named tuple class" },
  { label: "deque()", type: "class", info: "Double-ended queue" },
  { label: "ChainMap()", type: "class", info: "Multiple mappings as one" },
];

const ITERTOOLS_COMPLETIONS: Completion[] = [
  { label: "chain()", type: "function", info: "Chain iterables together" },
  { label: "product()", type: "function", info: "Cartesian product" },
  { label: "permutations()", type: "function", info: "Permutations of iterable" },
  { label: "combinations()", type: "function", info: "Combinations of iterable" },
  { label: "groupby()", type: "function", info: "Group consecutive elements" },
  { label: "islice()", type: "function", info: "Slice an iterator" },
  { label: "starmap()", type: "function", info: "Map function with args unpacked" },
  { label: "repeat()", type: "function", info: "Repeat value n times" },
  { label: "cycle()", type: "function", info: "Cycle through iterable" },
  { label: "count()", type: "function", info: "Count from start" },
  { label: "accumulate()", type: "function", info: "Accumulate values with function" },
];

const FUNCTOOLS_COMPLETIONS: Completion[] = [
  { label: "reduce()", type: "function", info: "Apply function cumulatively" },
  { label: "partial()", type: "function", info: "Partial application of function" },
  { label: "lru_cache()", type: "decorator", info: "LRU cache decorator" },
  { label: "cache()", type: "decorator", info: "Simple cache decorator" },
  { label: "wraps()", type: "decorator", info: "Update wrapper function" },
  { label: "total_ordering()", type: "decorator", info: "Fill in comparison methods" },
];

const TYPING_COMPLETIONS: Completion[] = [
  { label: "List", type: "type", info: "List type annotation" },
  { label: "Dict", type: "type", info: "Dict type annotation" },
  { label: "Tuple", type: "type", info: "Tuple type annotation" },
  { label: "Set", type: "type", info: "Set type annotation" },
  { label: "Optional", type: "type", info: "Optional type (X | None)" },
  { label: "Union", type: "type", info: "Union of types" },
  { label: "Any", type: "type", info: "Any type" },
  { label: "Callable", type: "type", info: "Callable type" },
  { label: "Iterator", type: "type", info: "Iterator type" },
  { label: "Generator", type: "type", info: "Generator type" },
  { label: "Type", type: "type", info: "Type of class" },
  { label: "ClassVar", type: "type", info: "Class variable annotation" },
  { label: "Final", type: "type", info: "Final (immutable) annotation" },
  { label: "TypeVar", type: "function", info: "Create type variable" },
  { label: "Protocol", type: "class", info: "Structural subtyping" },
  { label: "overload", type: "decorator", info: "Overload decorator" },
  { label: "cast()", type: "function", info: "Cast to type" },
];

const SKLEARN_COMPLETIONS: Completion[] = [
  { label: "train_test_split()", type: "function", info: "Split data into train/test sets" },
  { label: "StandardScaler()", type: "class", info: "Standardize features" },
  { label: "MinMaxScaler()", type: "class", info: "Scale features to range" },
  { label: "LabelEncoder()", type: "class", info: "Encode target labels" },
  { label: "OneHotEncoder()", type: "class", info: "One-hot encode categorical features" },
  { label: "LinearRegression()", type: "class", info: "Linear regression model" },
  { label: "LogisticRegression()", type: "class", info: "Logistic regression model" },
  { label: "RandomForestClassifier()", type: "class", info: "Random forest classifier" },
  { label: "RandomForestRegressor()", type: "class", info: "Random forest regressor" },
  { label: "SVC()", type: "class", info: "Support vector classifier" },
  { label: "KMeans()", type: "class", info: "K-Means clustering" },
  { label: "Pipeline()", type: "class", info: "Chain transformers and estimator" },
  { label: "cross_val_score()", type: "function", info: "Cross-validated scores" },
  { label: "GridSearchCV()", type: "class", info: "Exhaustive hyperparameter search" },
  { label: "accuracy_score()", type: "function", info: "Accuracy classification score" },
  { label: "confusion_matrix()", type: "function", info: "Confusion matrix" },
  { label: "classification_report()", type: "function", info: "Classification metrics report" },
  { label: "mean_squared_error()", type: "function", info: "Mean squared error" },
  { label: "r2_score()", type: "function", info: "R² score" },
];

// ── Library map: alias or module name → completions ─────────────────────────

export const LIBRARY_COMPLETIONS: Record<string, Completion[]> = {
  pd: PANDAS_COMPLETIONS,
  pandas: PANDAS_COMPLETIONS,
  df: DATAFRAME_COMPLETIONS,
  np: NUMPY_COMPLETIONS,
  numpy: NUMPY_COMPLETIONS,
  requests: REQUESTS_COMPLETIONS,
  os: OS_COMPLETIONS,
  json: JSON_COMPLETIONS,
  datetime: DATETIME_COMPLETIONS,
  re: RE_COMPLETIONS,
  math: MATH_COMPLETIONS,
  pathlib: PATHLIB_COMPLETIONS,
  pl: PATHLIB_COMPLETIONS,
  collections: COLLECTIONS_COMPLETIONS,
  itertools: ITERTOOLS_COMPLETIONS,
  functools: FUNCTOOLS_COMPLETIONS,
  typing: TYPING_COMPLETIONS,
  sklearn: SKLEARN_COMPLETIONS,
  skl: SKLEARN_COMPLETIONS,
};

// Aliases that point to DataFrame completions (for variables detected as DataFrames)
export const DATAFRAME_ALIAS_HINTS = new Set(["df", "data", "result", "table", "frame"]);

// ── Parse import aliases from code ──────────────────────────────────────────

export function parseImportAliases(code: string): Record<string, string> {
  const aliases: Record<string, string> = {};
  const importAsRe = /import\s+([\w.]+)\s+as\s+(\w+)/g;
  const fromImportRe = /from\s+([\w.]+)\s+import\s+([\w,\s*]+)/g;
  const plainImportRe = /^import\s+([\w.]+)$/gm;

  let m: RegExpExecArray | null;
  while ((m = importAsRe.exec(code)) !== null) {
    aliases[m[2]] = m[1].split(".")[0];
  }
  while ((m = plainImportRe.exec(code)) !== null) {
    const mod = m[1].split(".")[0];
    aliases[mod] = mod;
  }
  while ((m = fromImportRe.exec(code)) !== null) {
    const fromMod = m[1].split(".")[0];
    const names = m[2].split(",").map((n) => n.trim());
    for (const n of names) {
      if (n && n !== "*") aliases[n] = fromMod;
    }
  }
  return aliases;
}

// ── CodeMirror completion source ────────────────────────────────────────────

export function pythonLibraryCompletionSource(context: CompletionContext): CompletionResult | null {
  const code = context.state.doc.toString();
  const aliases = parseImportAliases(code);

  // Match word.prefix → show library completions for that word
  const dotMatch = context.matchBefore(/(\w+)\.\w*/);
  if (!dotMatch) return null;

  const objName = dotMatch.text.split(".")[0];
  const partialMethod = dotMatch.text.split(".")[1] ?? "";

  const libName = aliases[objName] ?? objName;
  const completions = LIBRARY_COMPLETIONS[libName] ?? LIBRARY_COMPLETIONS[objName];

  if (!completions) return null;

  const from = dotMatch.from + objName.length + 1;

  return {
    from,
    options: completions.filter((c) =>
      !partialMethod || c.label.toLowerCase().startsWith(partialMethod.toLowerCase())
    ),
    validFor: /^\w*/,
  };
}
