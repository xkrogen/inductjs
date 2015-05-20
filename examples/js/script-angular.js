var globalScope;

angular.module('fasterAngular', []).controller('mycontroller', ['$scope', function($scope) {
    $scope.dataLines = dataLines;
    updateRowCount();
    globalScope = $scope;
}]).filter('unsafe', function ($sce) { return $sce.trustAsHtml; });

rerender = function() {
    /* Force Angular to perform a check and rerender as necessary */
    globalScope.$apply(function() {});
};

