var markup;
if (USE_NESTED) {
    if (USE_TEXT)
        markup = '<table><tr><th colSpan="5">Large Nested List:</th></tr>{tr{for(line) context.dataLines}}<td>{span{for(token) context.line}}{{text context.token}}{{/for}}</td>{{/for}}</table>';
    else
        markup = '<table><tr><th colSpan="5">Large Nested List:</th></tr>{tr{for(line) context.dataLines}}<td>{span{for(token) context.line}}{{context.token}}{{/for}}</td>{{/for}}</table>';
} else {
    if (USE_TEXT)
        markup = '<table><tr><th colSpan="5">Large List:</th></tr>{tr{for(line) context.dataLines}}<td><span>{{text context.line}}</span></td>{{/for}}</table>';
    else
        markup = '<table><tr><th colSpan="5">Large List:</th></tr>{tr{for(line) context.dataLines}}<td><span>{{context.line}}</span></td>{{/for}}</table>';
}
var insrtPt = document.getElementById("insertPoint");

var tmpl = compile(markup);
var time = new Date().getTime();
tmpl = render(tmpl, {dataLines: dataLines}, insrtPt);
console.log('Initial render with custom took ' + (new Date().getTime() - time) + ' ms');

rerender = function() {
    render(tmpl, {dataLines: dataLines});
};
