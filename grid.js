// grid.js

import E from "./e.js";
// TODO: import {captureUtils} from "./eventutils.js";
import {defer, demand, mostRecent} from "./i.js";

const max = (a,b) => a<b ? b : a;


const MINWIDTH = 40;
const rowHeight = 22;


//--------------------------------------------------------------
// Element styling classes
//--------------------------------------------------------------
//
// Sizing: The top-level element, GridView.e, fills its containing block.
//
// Anchoring: We want to be able to move all items in a column to the left
// or right (and other columns to the right) by setting a single attribute
// (or a small finite number of them), and we want to move *all* cells up
// and down (scrolling).
//
// We do this with grid layout: each cell is a child of the grid, and has
// its own col/row position.  The grid can be moved up/down (e.g. by placing
// inside an "overflow: scroll" element.  Separate "row" elements (for
// even/odd background effects and pointer events) are children of the grid,
// with column start at 1 and end at MAX.
//
// Scrolling: Data cells should scroll horiz & vert, but headers should move
// only horiz.  Therefore, we have *two* grids (siblings), one for data
// cells and one for headers.  The data grid is `overflow: scroll` and we
// use JS to update the header grid's horizontal position to match.
//
//     Absolute positioning would probably work as well as (better then?)
//     grid layout.  Each cell could be a child of a column element, and row
//     elements being children of the first column, and columns being a
//     child of a parent "grid" (which can be scrolled).


const GridBase = E.derive({
    display: "grid",
    gridAutoRows: rowHeight + "px",
    font: "12px -apple-system, Helvetica, 'Lucida Grande', sans-serif",
    userSelect: "none",
});


const DataGrid = GridBase.derive("DataGrid", {
    overflow: "scroll",         // scroll up/down (just data cells, not headers)
    position: "absolute",
    top: 2,
    bottom: 0,
    left: 0,
    right: 0,
});


const DataRow = E.derive("DataRow", {
    gridArea: "1 / 1 / auto / -1",
    "?.odd" : {
        background: "#f3f3f3",
    },
    "?.selected": {
        background: "rgba(180,200,255, 0.4)",
    },
});


const DataCell = E.derive("DataCell", {
    padding: "3px 5px",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    pointerEvents: "none",
});


// HdrGrid consists of one row, plus a single pixel of border above and
// below.  It contains one HdrCell for each column.
//
//  - A divider line appears at the right edge of each header cell (in the
//    rightmost pixel column of each grid cell).
//  - The divider line (and the few pixels left and right of it) is
//    "draggable" when its column it resizable.
//  - The header text must be clipped => "overflow: hidden" on some element.
//  - The draggable area of a cell divider extends beyond the grid cell into
//    the next grid cell to the right (so it must be layered above the cell
//    to the right).
//


const HdrGrid = GridBase.derive("HdrGrid", {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    border: "1px solid #e6e6e6",  // this makes HdrGrid two pixels taller than one row
    borderWidth: "1px 0",
    background: "white",
});


const HdrCell = E.derive("HdrCell", {
    position: "relative",
});


// "sort" class => header is primary sort key
// "up" class => sort direction is ascending
//
const HdrLabel = E.derive("HdrLabel", {
    padding: "4px 5px 2px 4px",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "none",
    position: "relative",
    background: "white",
    left: 0,
    // sort keys are displayed slightly boldfaced
    "?.sort": {
        fontWeight: "600",
        paddingRight: 18,
    },
    // "::after" pseudo-element contains up/down indicator
    "?.sort::after": {
        position: "absolute",
        right: 3,
        content: "'\u25bc'",  // 0x25BC = Black down-pointing triangle: ▼
        color: "#aaa",
        fontWeight: "300",
        background: "inherit",
        width: 15,

        textAlign: "center",
        paddingTop: 2,
        fontSize: "90%",
    },
    "?.sort.up::after": {
        content: "'\u25B2'",  // 0x25B2 = Black up-pointing triangle: ▲
        paddingTop: 0,
    }
});


const Divider = E.derive("Divider", {
    position: "absolute",

    // The content area of this element is a thin vertical bar.
    background: "#e6e6e6",
    width: 1,
    right: -4,
    top: 0,
    height: 18,

    // The border is invisible (white-on-white) but part of the clickable
    // area.  The wider border on the right seems necessary for a "balanced"
    // look and feel to the mouseover events.
    borderWidth: "2px 4px 2px 3px",
    borderStyle: "solid",
    borderColor: "white",
});


const Dragger = Divider.derive("Dragger", {
    cursor: "col-resize",
});


//--------------------------------------------------------------
// GridTop
//--------------------------------------------------------------

const GridTop = E.derive("GridTop", {
    overflow: "hidden",
    background: "white",
    // fill parent
    position: "absolute",
    right: 0,
    bottom: 0,
    left: 0,
    top: 0,
});


const newRowElement = (rowIndex) => E.new({
    class: DataRow + (rowIndex % 2 == 1 ? " odd" : ""),
    style: {
        gridRowStart: String(rowIndex),
    }
});


const newCell = (value, fmt, align, rowIndex, colIndex) => DataCell.new({
    content: [fmt ? fmt(value) : value],
    style: {
        textAlign: align || "",
        gridArea: (rowIndex+2) + " / " + (colIndex+1),
    },
});


const createGridCells = (db, columns, fields) => {
    const o = [];

    // blank row prior to top row (visible only during overscroll)
    o.push(newRowElement(o, 1));

    db.forEach((rec, rowIndex) => {
        // row element
        o.push(newRowElement(rowIndex + 2));

        // cells for each column
        columns.forEach( (c, colIndex) => {
            if (c.key) {
                const value = rec[c.key];
                const {fmt, align} = fields[c.key];
                o.push(newCell(value, fmt, align, rowIndex, colIndex));
            }
        });
    });
    return o;
};


// Note: column header elements must appear in reverse order so that
// dragger elements stack correctly.
//
const newColHeader = (fields, colInfo, colIndex) => {
    const {key, width, sort} = colInfo;
    const {label, align} = (key ? fields[key] : {});

    let colWidth, eDivider;
    if (key == null) {
        eDivider = Divider.new();
        colWidth = width;
    } else {
        eDivider = Dragger.new();
        const dragPos = mostRecent(E.dragStream(eDivider), {dx: 0});
        colWidth = defer(_ => width + demand(dragPos).dx);
    }

    // header label
    const eLabel =
          (label
           ? E.new({
               content: label,
               class: HdrLabel + (sort ? " sort " + sort : ""),
               style: {
                   textAlign: (align ? align : ""),
                   fontWeight: (sort ? "600" : ""),
               },})
           : null);

    const cell = HdrCell.new({
        content: [
            eLabel,
            eDivider
        ],
        style: {
            gridArea: "1 / " + (colIndex+1),
        },
    });

    return [cell, colWidth];
};


// columns = array of {key, width, sort}
//    This describes which columns are displayed and how.
//      key: index into `fields` and `db` rows
//      width: displayed column width, in pixels.
//      sort: null | "up" | "down"  (visual indicator of sorting)
//
// fields = map of key -> {label, align}
//    This describes contents of the database.
//      label: Text for the column header.
//      align: "right" | "center" | null; how column & header is aligned
//
// db = array of rows;  row = key -> text
//
const newGrid = (columns, fields, db, fnRowClicked) => {

    // GridTop
    //    DataGrid
    //      DataRow, DataCell
    //    HdrGrid
    //      HdrCell ...
    //

    // Construct column headers & get (resizing) widths for each
    const widths = [];
    const headers = columns.map((colInfo, colIndex) => {
        const [cell, width] = newColHeader(fields, colInfo, colIndex);
        widths.push(width);
        return cell;
    }).reverse();

    // This value describes the widths of all columns
    const gtc = defer(_ => widths.map(w => demand(w)+"px").join(" ") + " 1fr");

    const hdrGrid = HdrGrid.new({
        style: {
            gridTemplateColumns: gtc,
        },
        content: headers,
    });

    const dataGrid = DataGrid.new({
        style: {
            gridTemplateColumns: gtc,
        },
        content: defer(_ => createGridCells(demand(db), columns, fields)),
        listeners: {
            scroll: () => {
                hdrGrid.style.left = -dataGrid.scrollLeft + "px";
            },
            mousedown: (evt) => {
                const rowLine = evt.target.style.gridRowStart;
                if (rowLine > 1) {
                    if (fnRowClicked) {
                        fnRowClicked(rowLine-2, db);
                    }
                }
            },
        }
    });

    return  GridTop.new({
        content: [dataGrid, hdrGrid],
    });
};


export default newGrid;