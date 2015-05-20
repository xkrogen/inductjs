var RowComponent = React.createClass({displayName: "RowComponent",
    render: function() {
        var keyID = 0;
        var spans = this.props.dataLine.map(function(datum) {
            keyID += 1;
            return React.DOM.span({key: keyID}, datum);
        });
        return React.DOM.tr(null, React.DOM.td(null, spans));
    }
});

var ListComponent = React.createClass({displayName: 'ListComponent',
    render: function() {
        var headerRow, keyID = 0;
        var rows = this.props.dataLines.map(function(dataLine) {
            keyID += 1;
            if (USE_NESTED)
                return React.createElement(RowComponent, {key: keyID, dataLine: dataLine});
            else
                return React.DOM.tr({key: keyID}, React.DOM.td(null, React.DOM.span(null, dataLine)));
        });
        keyID += 1;
        headerRow = React.DOM.tr({key: keyID}, React.DOM.th({colSpan: "5"}, USE_NESTED ? "Large Nested List:" : "Large List"));
        rows.unshift(headerRow);
        return React.DOM.table(null, React.DOM.tbody(null, rows));
    }
});

var insrtPt = document.getElementById("insertPoint");

var start = new Date().getTime();
var reactComponent = React.createElement(ListComponent, {dataLines: dataLines});
React.render(reactComponent, insrtPt);
displayMessage('Initial rendering took ' + (new Date().getTime() - start) + 'ms');

rerender = function() {
    React.render(reactComponent, insrtPt);
};